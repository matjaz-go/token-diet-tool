// Ported from tool-diet's src/lib/sessions.js (collectSessionSummaries,
// collectRepeatedReads) — same parsing logic, same field semantics, adapted
// to this app's windowCutoff (midnight-anchored) instead of tool-diet's
// rolling cutoff. Real data only: reads each project's own
// ~/.claude/projects/**/*.jsonl, nothing else.

import fs from 'node:fs'
import type { ModelUsage } from './pricing'
import { listSessionFiles, windowCutoff } from './fsPaths'

export interface SessionSummary {
  file: string
  firstTs: number | null
  lastTs: number | null
  durationMs: number
  userTurns: number
  models: Map<string, ModelUsage>
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheCreation: number
}

// Per-session rollups: duration, turn count, and real token/cache usage
// summed from each assistant turn's `message.usage`.
export function collectSessionSummaries(cwd: string, sinceDays: number): SessionSummary[] {
  const cutoff = windowCutoff(sinceDays)
  const summaries: SessionSummary[] = []

  for (const file of listSessionFiles(cwd)) {
    let lines: string[]
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    } catch {
      continue
    }

    let firstTs: number | null = null
    let lastTs: number | null = null
    let userTurns = 0
    let inputTokens = 0
    let outputTokens = 0
    let cacheRead = 0
    let cacheCreation = 0
    const models = new Map<string, ModelUsage>()

    for (const line of lines) {
      let entry: any
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      const ts = entry.timestamp ? Date.parse(entry.timestamp) : null
      // Turn-level filter, not session-level: a session whose *last* message
      // falls inside the window can still have started well before it.
      if (ts && ts < cutoff) continue
      if (ts) {
        if (!firstTs || ts < firstTs) firstTs = ts
        if (!lastTs || ts > lastTs) lastTs = ts
      }
      if (entry.type === 'user' && !entry.isSidechain) userTurns += 1
      if (entry.type === 'assistant') {
        const msg = entry.message || {}
        const usage = msg.usage
        if (usage) {
          inputTokens += usage.input_tokens || 0
          outputTokens += usage.output_tokens || 0
          cacheRead += usage.cache_read_input_tokens || 0
          cacheCreation += usage.cache_creation_input_tokens || 0

          if (msg.model) {
            const rec = models.get(msg.model) || {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheCreation5m: 0,
              cacheCreation1h: 0,
              thinking: 0
            }
            rec.input += usage.input_tokens || 0
            rec.output += usage.output_tokens || 0
            rec.cacheRead += usage.cache_read_input_tokens || 0
            rec.thinking = (rec.thinking || 0) + (usage.output_tokens_details?.thinking_tokens || 0)
            // cache_creation splits 1h vs 5m writes when present; fall back
            // to treating the total as a 5m write (the default TTL) when the
            // sub-object is missing, rather than silently dropping it.
            const cc = usage.cache_creation
            if (cc) {
              rec.cacheCreation1h += cc.ephemeral_1h_input_tokens || 0
              rec.cacheCreation5m += cc.ephemeral_5m_input_tokens || 0
            } else {
              rec.cacheCreation5m += usage.cache_creation_input_tokens || 0
            }
            models.set(msg.model, rec)
          }
        }
      }
    }

    if (!lastTs) continue // no turns at all fell inside the window
    summaries.push({
      file,
      firstTs,
      lastTs,
      durationMs: firstTs && lastTs ? lastTs - firstTs : 0,
      userTurns,
      models,
      inputTokens,
      outputTokens,
      cacheRead,
      cacheCreation
    })
  }
  return summaries
}

export interface RepeatedReadRec {
  count: number
  approxTokens: number
}

function resultTextLength(content: any): number {
  if (typeof content === 'string') return content.length
  if (Array.isArray(content)) {
    return content.reduce((sum: number, c: any) => sum + (typeof c?.text === 'string' ? c.text.length : 0), 0)
  }
  return 0
}

// Pairs each Read tool_use with its tool_result to estimate real tokens per
// read, then groups by file path.
export function collectRepeatedReads(cwd: string, sinceDays: number): Map<string, RepeatedReadRec> {
  const cutoff = windowCutoff(sinceDays)
  const byFile = new Map<string, RepeatedReadRec>()
  const pending = new Map<string, string>() // tool_use_id -> filePath

  for (const file of listSessionFiles(cwd)) {
    let lines: string[]
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    } catch {
      continue
    }
    for (const line of lines) {
      let entry: any
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      const ts = entry.timestamp ? Date.parse(entry.timestamp) : null
      const inWindow = !ts || ts >= cutoff

      if (entry.type === 'assistant') {
        for (const block of entry.message?.content || []) {
          if (block?.type === 'tool_use' && block.name === 'Read' && block.input?.file_path) {
            if (inWindow) pending.set(block.id, block.input.file_path)
          }
        }
      }

      if (entry.type === 'user') {
        for (const block of entry.message?.content || []) {
          if (block?.type === 'tool_result' && pending.has(block.tool_use_id)) {
            const filePath = pending.get(block.tool_use_id)!
            pending.delete(block.tool_use_id)
            const rec = byFile.get(filePath) || { count: 0, approxTokens: 0 }
            rec.count += 1
            rec.approxTokens += Math.round(resultTextLength(block.content) / 4)
            byFile.set(filePath, rec)
          }
        }
      }
    }
  }
  return byFile
}
