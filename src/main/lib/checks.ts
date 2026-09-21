// Ported from tool-diet's src/checks/*.js — same thresholds, same
// formulas, adapted to aggregate across every project on this machine
// instead of tool-diet's single-project `cwd`. Each function returns a
// Finding (or null if nothing to report), with detail/fix text pre-rendered
// here exactly like tool-diet's own checks do.
//
// Simplified from upstream: claude-md-bloat only ports the "over 200 lines"
// branch (the primary, quantified, warn-status finding). Upstream's
// secondary "thin CLAUDE.md + repeated-reads evidence" correlation (status
// 'info') is per-project by nature and adds real complexity for a lower-value
// signal — left out of this pass rather than built half-right.

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import type { Finding, FindingId, PotentialReduction } from '../../shared/types'
import type { SessionSummary, RepeatedReadRec } from './sessionAnalytics'
import type { ModelUsage } from './pricing'
import { estimateCostBreakdown, estimateCostUsd, priceFor } from './pricing'
import { fmtTokens, fmtUsd } from './format'

function sessionTotalTokens(s: SessionSummary): number {
  return s.inputTokens + s.outputTokens + s.cacheRead + s.cacheCreation
}

// --- cache health -----------------------------------------------------

const CACHE_WARN_HIT_RATE = 0.5
const CACHE_WARN_MIN_CONTEXT_TOKENS = 50_000

export interface CacheHealthResult {
  finding: Finding
  hitRate: number
}

export function checkCacheHealth(summaries: SessionSummary[]): CacheHealthResult | null {
  if (summaries.length === 0) return null

  let input = 0
  let cacheRead = 0
  let cacheCreation = 0
  let output = 0
  for (const s of summaries) {
    input += s.inputTokens
    cacheRead += s.cacheRead
    cacheCreation += s.cacheCreation
    output += s.outputTokens
  }

  const contextTokens = input + cacheRead + cacheCreation
  const hitRate = contextTokens > 0 ? cacheRead / contextTokens : 0
  const warn = hitRate < CACHE_WARN_HIT_RATE && contextTokens >= CACHE_WARN_MIN_CONTEXT_TOKENS
  const missedTokens = input + cacheCreation

  return {
    hitRate,
    finding: {
      id: 'cache-health',
      label: 'Cache health',
      status: warn ? 'warn' : 'ok',
      impactTokens: warn ? missedTokens : undefined,
      recommendText: warn
        ? `Investigate cache invalidation — hit rate is only ${Math.round(hitRate * 100)}%, normal is 90%+`
        : undefined,
      detail: `${summaries.length} session(s), ${fmtTokens(contextTokens)} context tokens processed, ${Math.round(
        hitRate * 100
      )}% served from cache, ${fmtTokens(output)} output tokens.`,
      fix: warn
        ? [
            'Low cache-hit rate usually means sessions sit idle past the cache TTL (1h), or something keeps invalidating it mid-session (CLAUDE.md edits, tool-definition changes).',
            'See code.claude.com/docs/en/prompt-caching#actions-that-invalidate-the-cache.'
          ]
        : undefined
    }
  }
}

// --- cost & models ------------------------------------------------------

export interface CostBreakdownResult {
  finding: Finding
  totalUsd: number
}

// Returns both the Finding (whose impactTokens/impactUsd are specifically
// the *reducible* thinking-cost portion) and the total weekly spend
// separately — total spend is a real, valuable stat on its own, but it
// isn't "impact/waste" and doesn't belong conflated with that field.
export function checkCostBreakdown(summaries: SessionSummary[]): CostBreakdownResult | null {
  if (summaries.length === 0) return null

  const totals = new Map<string, ModelUsage>()
  for (const s of summaries) {
    for (const [model, u] of s.models.entries()) {
      const rec = totals.get(model) || {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation5m: 0,
        cacheCreation1h: 0,
        thinking: 0
      }
      rec.input += u.input
      rec.output += u.output
      rec.cacheRead += u.cacheRead
      rec.cacheCreation5m += u.cacheCreation5m
      rec.cacheCreation1h += u.cacheCreation1h
      rec.thinking = (rec.thinking || 0) + (u.thinking || 0)
      totals.set(model, rec)
    }
  }
  for (const [model, u] of [...totals]) {
    if (u.input + u.output + u.cacheRead + u.cacheCreation5m + u.cacheCreation1h === 0) totals.delete(model)
  }
  if (totals.size === 0) return null

  const lines: string[] = []
  let grandTotal = 0
  let inputTotal = 0
  let inputCostTotal = 0
  let outputTotal = 0
  let thinkingTokensTotal = 0
  let thinkingCostTotal = 0
  let allContextTokens = 0
  let allOutputTokens = 0
  let anyUnpriced = false

  const sorted = [...totals.entries()].sort((a, b) => {
    const costA = estimateCostBreakdown(a[0], a[1])?.total ?? -1
    const costB = estimateCostBreakdown(b[0], b[1])?.total ?? -1
    return costB - costA
  })

  for (const [model, u] of sorted) {
    const b = estimateCostBreakdown(model, u)
    const contextTokens = u.input + u.cacheRead + u.cacheCreation5m + u.cacheCreation1h
    allContextTokens += contextTokens
    allOutputTokens += u.output
    if (!b) {
      anyUnpriced = true
      lines.push(
        `${model}: ${fmtTokens(contextTokens)} context / ${fmtTokens(u.output)} output tokens — no pricing data for this model`
      )
      continue
    }
    grandTotal += b.total
    inputTotal += u.input
    inputCostTotal += b.input
    outputTotal += u.output
    lines.push(`${model} ≈${fmtUsd(b.total)} total`)
    if (u.thinking && u.thinking > 0) {
      const outputPrice = priceFor(model)?.output ?? 0
      const thinkingCost = (u.thinking / 1_000_000) * outputPrice
      const pct = u.output > 0 ? Math.round((u.thinking / u.output) * 100) : 0
      thinkingTokensTotal += u.thinking
      thinkingCostTotal += thinkingCost
      lines.push(`  of which thinking: ${fmtTokens(u.thinking)} tok (${pct}% of output) ≈${fmtUsd(thinkingCost)}`)
    }
  }

  const thinkingPctOfOutput = outputTotal > 0 ? Math.round((thinkingTokensTotal / outputTotal) * 100) : 0

  return {
    totalUsd: grandTotal,
    finding: {
      id: 'cost-breakdown',
      label: 'Cost & models',
      status: 'info',
      impactTokens: thinkingTokensTotal > 0 ? thinkingTokensTotal : undefined,
      // The reducible thinking-cost portion, matching tool-diet's own
      // semantic — NOT the total weekly spend (that's totalUsd above, and
      // in `detail` below as context, but doesn't belong on a field named
      // "impact").
      impactUsd: thinkingCostTotal > 0 ? thinkingCostTotal : undefined,
      recommendText:
        thinkingCostTotal > 0
          ? `Lower /effort or disable thinking for simple turns — thinking is ${thinkingPctOfOutput}% of output tokens this window`
          : undefined,
      detail: `${fmtTokens(allContextTokens)} context + ${fmtTokens(allOutputTokens)} output tokens, ${
        totals.size
      } model(s) used ≈${fmtUsd(grandTotal)} at list price${anyUnpriced ? ' (some usage unpriced)' : ''}. Fresh input alone: ${fmtTokens(
        inputTotal
      )} ≈${fmtUsd(inputCostTotal)}.`,
      fix: [...lines, 'Estimate only: list price, no org/contracted rate. Check /usage for your real bill.']
    }
  }
}

// --- long, low-activity sessions -----------------------------------------

const LONG_SESSION_HOURS = 3
const LOW_DENSITY_TURNS_PER_HOUR = 2

function sessionCostUsd(s: SessionSummary): number | undefined {
  let total = 0
  for (const [model, u] of s.models.entries()) {
    const c = estimateCostUsd(model, u)
    if (c === null) return undefined
    total += c
  }
  return total
}

export function checkLongSessions(
  summaries: { summary: SessionSummary; projectPath: string }[]
): Finding | null {
  if (summaries.length === 0) return null

  const flagged = summaries.filter(({ summary: s }) => {
    const hours = s.durationMs / 3_600_000
    const density = hours > 0 ? s.userTurns / hours : Infinity
    return hours >= LONG_SESSION_HOURS && density < LOW_DENSITY_TURNS_PER_HOUR
  })
  if (flagged.length === 0) return null

  const total = flagged.reduce((sum, { summary: s }) => sum + sessionTotalTokens(s), 0)
  const costs = flagged.map(({ summary: s }) => sessionCostUsd(s))
  const impactUsd = costs.every((c) => c !== undefined)
    ? costs.reduce((sum: number, c) => sum + (c || 0), 0)
    : undefined

  return {
    id: 'long-sessions',
    label: 'Long, low-activity sessions',
    status: 'warn',
    impactTokens: total,
    impactUsd,
    recommendText: `/clear between unrelated tasks — ${flagged.length} long, low-activity session(s) this window`,
    detail: `${flagged.length} session(s) ran ${LONG_SESSION_HOURS}h+ with under ${LOW_DENSITY_TURNS_PER_HOUR} turns/hour — ${fmtTokens(
      total
    )} tokens across them${impactUsd !== undefined ? ` (≈${fmtUsd(impactUsd)})` : ''}, most of it the same stale context re-sent every turn.`,
    fix: flagged
      .sort((a, b) => sessionTotalTokens(b.summary) - sessionTotalTokens(a.summary))
      .slice(0, 3)
      .map(
        ({ summary: s, projectPath }) =>
          `${path.basename(projectPath)}: ${(s.durationMs / 3_600_000).toFixed(1)}h, ${s.userTurns} turn(s), ~${fmtTokens(
            sessionTotalTokens(s)
          )} tokens`
      )
  }
}

// --- repeated file reads ---------------------------------------------------

const REPEAT_MIN = 3
const REPEAT_TOP_N = 5

export function checkRepeatedReads(byFile: Map<string, RepeatedReadRec>): Finding | null {
  if (byFile.size === 0) return null

  const repeated = [...byFile.entries()]
    .filter(([, rec]) => rec.count >= REPEAT_MIN)
    .sort((a, b) => b[1].approxTokens - a[1].approxTokens)
  if (repeated.length === 0) return null

  const totalTokens = repeated.reduce((sum, [, rec]) => sum + rec.approxTokens, 0)

  return {
    id: 'repeated-reads',
    label: 'Repeated file reads',
    status: 'info',
    impactTokens: totalTokens,
    recommendText: `Summarize or skill-ify the most-reread file(s): ${repeated
      .slice(0, 2)
      .map(([f]) => path.basename(f))
      .join(', ')}`,
    detail: `${repeated.length} file(s) were read ${REPEAT_MIN}+ times this window — ~${fmtTokens(
      totalTokens
    )} tokens across the repeats. Could be legitimate paging, or context lost to compaction and re-read from scratch.`,
    fix: repeated
      .slice(0, REPEAT_TOP_N)
      .map(([filePath, rec]) => `${path.basename(filePath)}: read ${rec.count}× (~${fmtTokens(rec.approxTokens)} tok)`)
  }
}

// --- CLAUDE.md bloat --------------------------------------------------

const CLAUDE_MD_LINE_LIMIT = 200
const CHARS_PER_TOKEN = 4

interface ClaudeMdInfo {
  projectPath: string
  file: string
  lines: number
  approxTokens: number
  headings: string[]
}

function readClaudeMd(projectPath: string): ClaudeMdInfo | null {
  for (const name of ['CLAUDE.md', 'claude.md']) {
    const p = path.join(projectPath, name)
    if (!fs.existsSync(p)) continue
    let text: string
    try {
      text = fs.readFileSync(p, 'utf8')
    } catch {
      return null
    }
    const lines = text.split('\n')
    const headings = lines.filter((l) => /^#{1,3}\s/.test(l)).map((h) => h.replace(/^#+\s*/, ''))
    return { projectPath, file: p, lines: lines.length, approxTokens: Math.round(text.length / CHARS_PER_TOKEN), headings }
  }
  return null
}

export function checkClaudeMdBloat(projectPaths: string[]): Finding | null {
  const bloated: ClaudeMdInfo[] = []
  for (const p of projectPaths) {
    const info = readClaudeMd(p)
    if (info && info.lines > CLAUDE_MD_LINE_LIMIT) bloated.push(info)
  }
  if (bloated.length === 0) return null

  bloated.sort((a, b) => b.approxTokens - a.approxTokens)
  const totalTokens = bloated.reduce((sum, b) => sum + b.approxTokens, 0)

  return {
    id: 'claude-md-bloat',
    label: 'CLAUDE.md bloat',
    status: 'warn',
    impactTokens: totalTokens,
    recommendText: `Move workflow-specific sections out of ${bloated.length > 1 ? `${bloated.length} projects'` : "this project's"} CLAUDE.md into skills`,
    detail: `${bloated.length} project(s) have a CLAUDE.md over the ${CLAUDE_MD_LINE_LIMIT}-line guideline — ~${fmtTokens(
      totalTokens
    )} tokens that load into every session there, regardless of task.`,
    fix: bloated.slice(0, 5).map((b) => {
      const candidates = b.headings.slice(0, 4).join(', ')
      return `${path.basename(b.projectPath)}: ${b.lines} lines (~${fmtTokens(b.approxTokens)} tok)${
        candidates ? ` — candidates: ${candidates}` : ''
      }`
    })
  }
}

// --- MCP <-> CLI redundancy --------------------------------------------

const CLI_EQUIVALENTS: Record<string, string> = {
  github: 'gh',
  aws: 'aws',
  gcloud: 'gcloud',
  sentry: 'sentry-cli',
  postgres: 'psql',
  vercel: 'vercel',
  stripe: 'stripe'
}

function cliFor(serverName: string): string | null {
  const key = serverName.toLowerCase().replace(/-?mcp$/, '')
  return CLI_EQUIVALENTS[key] || null
}

function hasCli(bin: string): boolean {
  try {
    execSync(`command -v ${bin}`, { stdio: 'ignore', shell: '/bin/bash' })
    return true
  } catch {
    return false
  }
}

// Only 'project'-source servers — matches tool-diet's own scope (it only
// reads .mcp.json-configured servers, same as this check should).
export function checkMcpCliRedundancy(projectServerNames: string[]): Finding | null {
  const uniqueNames = [...new Set(projectServerNames)]
  const hits: { server: string; cli: string }[] = []
  for (const name of uniqueNames) {
    const cli = cliFor(name)
    if (cli && hasCli(cli)) hits.push({ server: name, cli })
  }
  if (hits.length === 0) return null

  return {
    id: 'mcp-cli-redundancy',
    label: 'MCP ↔ CLI redundancy',
    status: 'warn',
    recommendText: `Point CLAUDE.md at the CLI instead of MCP for: ${hits.map((h) => h.server).join(', ')}`,
    detail: `${hits.length} configured server(s) have a CLI equivalent already installed. A CLI call costs no per-tool schema line; an MCP server always costs at least a name+description entry.`,
    fix: hits.map((h) => `${h.server} → \`${h.cli}\` is on PATH — point CLAUDE.md at it instead.`)
  }
}

// --- headline potential reduction ---------------------------------------

// A real, de-duplicated "N tokens reducible" headline needs a sum that
// doesn't double-count or overstate. Only checks whose impactTokens are a
// distinct, non-overlapping, genuinely-reducible pool count toward it —
// cache-health's impact is a cost-per-token shape change (not a token
// count), and long-sessions' is the whole session's size (not a delta
// you'd get back), so neither contributes here even though both have a
// real impactTokens of their own. Ported from tool-diet's recommend.js.
const REDUCTION_IDS = new Set<FindingId>(['repeated-reads', 'claude-md-bloat', 'cost-breakdown'])

export function computePotentialReduction(findings: Finding[], windowTotalTokens: number): PotentialReduction | null {
  let total = 0
  const contributors: FindingId[] = []
  for (const f of findings) {
    if (typeof f.impactTokens !== 'number' || f.impactTokens <= 0) continue
    if (!REDUCTION_IDS.has(f.id)) continue
    total += f.impactTokens
    contributors.push(f.id)
  }
  if (total <= 0 || !windowTotalTokens) return null
  const pct = Math.round((total / windowTotalTokens) * 100)
  return { totalTokens: total, pct, contributors }
}
