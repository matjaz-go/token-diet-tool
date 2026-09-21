// Local, read-only scan of this machine's Claude Code config + session logs.
// Same data sources and field semantics as tool-diet (a separate,
// already-shipped CLI) — reimplemented locally rather than imported across
// repos, so this app stays self-contained if it's ever packaged/distributed.
//
// Two halves:
//  1. MCP server inventory — three genuinely different sources ('project',
//     'plugin', 'connector'; see ServerSource in ../shared/types.ts) feeding
//     the drill-down/kill-list flow.
//  2. Findings — cost, cache health, CLAUDE.md bloat, long sessions,
//     repeated reads, MCP<->CLI redundancy — ported from tool-diet's own
//     checks (src/main/lib/checks.ts), aggregated across every project
//     instead of tool-diet's single-project `cwd`.
//
// Touches: ~/.claude.json, each project's .mcp.json and CLAUDE.md, installed
// plugin manifests, and ~/.claude/projects/**/*.jsonl. Never the network,
// never spawns anything (mcp-cli-redundancy's `command -v` check is a local
// PATH lookup, not a spawn of anything user-configured).

import os from 'node:os'
import path from 'node:path'
import type { RealServer, RealTool, ScanResult, ServerSource } from '../shared/types'
import { claudeHome, loadProjectMcpConfig, readJsonSafe, listSessionFiles, windowCutoff } from './lib/fsPaths'
import { collectSessionSummaries, collectRepeatedReads, type RepeatedReadRec } from './lib/sessionAnalytics'
import {
  checkCacheHealth,
  checkCostBreakdown,
  checkLongSessions,
  checkRepeatedReads,
  checkClaudeMdBloat,
  checkMcpCliRedundancy,
  computePotentialReduction
} from './lib/checks'
import fs from 'node:fs'

interface PluginServerRef {
  id: string
  label: string
  projectPath?: string
}

function loadInstalledPluginServers(): PluginServerRef[] {
  const installed = readJsonSafe(path.join(claudeHome(), 'plugins', 'installed_plugins.json'))
  const out: PluginServerRef[] = []
  if (!installed?.plugins) return out

  for (const [pluginKey, installsRaw] of Object.entries<any>(installed.plugins)) {
    const shortName = pluginKey.split('@')[0]
    const installs = Array.isArray(installsRaw) ? installsRaw : []
    for (const record of installs) {
      const installPath = record?.installPath
      if (!installPath) continue
      const manifest = readJsonSafe(path.join(installPath, '.mcp.json'))
      const serverNames = Object.keys(manifest?.mcpServers || {})
      for (const serverName of serverNames) {
        out.push({
          id: `plugin_${shortName}_${serverName}`,
          label: `${shortName} (plugin)`,
          projectPath: record.scope === 'project' ? record.projectPath : undefined
        })
      }
    }
  }
  return out
}

interface ConnectorRef {
  id: string
  label: string
}

// "Ever connected" per ~/.claude.json, not "currently connected" — this app
// has no way to tell those apart locally, which is why connectors get
// idleConfidence: 'low' downstream and are never kill-list eligible.
function loadConnectorServers(globalConfig: any): ConnectorRef[] {
  const everConnected: string[] = globalConfig?.claudeAiMcpEverConnected || []
  const out: ConnectorRef[] = everConnected.map((label) => {
    const suffix = label
      .replace(/^claude\.ai\s+/i, '')
      .trim()
      .replace(/\s+/g, '_')
    return { id: `claude_ai_${suffix}`, label }
  })

  if (globalConfig?.claudeInChromeDefaultEnabled || globalConfig?.cachedChromeExtensionInstalled) {
    out.push({ id: 'claude-in-chrome', label: 'Chrome browser control' })
  }

  return out
}

interface ToolCallRec {
  calls: number
  lastUsed: number | null
}

function collectToolCallsAndTokens(
  cwd: string,
  sinceDays: number
): { calls: Map<string, ToolCallRec>; tokens: number } {
  const cutoff = windowCutoff(sinceDays)
  const counts = new Map<string, ToolCallRec>()
  let tokens = 0

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
      if (ts && ts < cutoff) continue
      if (entry.type !== 'assistant') continue

      const usage = entry.message?.usage
      if (usage) {
        tokens +=
          (usage.input_tokens || 0) +
          (usage.output_tokens || 0) +
          (usage.cache_read_input_tokens || 0) +
          (usage.cache_creation_input_tokens || 0)
      }

      const content = entry.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block?.type === 'tool_use' && block.name) {
          const rec = counts.get(block.name) || { calls: 0, lastUsed: null }
          rec.calls += 1
          if (ts && (!rec.lastUsed || ts > rec.lastUsed)) rec.lastUsed = ts
          counts.set(block.name, rec)
        }
      }
    }
  }

  return { calls: counts, tokens }
}

interface Agg {
  label: string
  source: ServerSource
  alwaysLoad: boolean
  killListEligible: boolean
  idleConfidence: 'high' | 'low'
  projects: Set<string>
  toolCalls: Map<string, number>
}

function getOrCreate(
  serverMap: Map<string, Agg>,
  id: string,
  defaults: Omit<Agg, 'projects' | 'toolCalls'>
): Agg {
  let agg = serverMap.get(id)
  if (!agg) {
    agg = { ...defaults, projects: new Set(), toolCalls: new Map() }
    serverMap.set(id, agg)
  }
  return agg
}

export function runScan(sinceDays = 7): ScanResult {
  const scannedAt = Date.now()
  const globalConfig = readJsonSafe(path.join(os.homedir(), '.claude.json'))

  if (!globalConfig) {
    return {
      scannedAt,
      sinceDays,
      projectsScanned: 0,
      servers: [],
      tokensThisWindow: 0,
      weeklySpendUsd: null,
      cacheHitRate: null,
      findings: [],
      potentialReduction: null,
      error: 'Could not read ~/.claude.json — is Claude Code installed on this machine?'
    }
  }

  const serverMap = new Map<string, Agg>()

  for (const plugin of loadInstalledPluginServers()) {
    const agg = getOrCreate(serverMap, plugin.id, {
      label: plugin.label,
      source: 'plugin',
      alwaysLoad: false,
      killListEligible: true,
      idleConfidence: 'high'
    })
    if (plugin.projectPath) agg.projects.add(plugin.projectPath)
  }

  for (const connector of loadConnectorServers(globalConfig)) {
    getOrCreate(serverMap, connector.id, {
      label: connector.label,
      source: 'connector',
      alwaysLoad: false,
      killListEligible: false,
      idleConfidence: 'low'
    })
  }

  const projectPaths: string[] = Object.keys(globalConfig.projects || {})
  let tokensThisWindow = 0
  let projectsScanned = 0

  // Cross-project aggregates for the findings below.
  const allSessionSummaries: { summary: ReturnType<typeof collectSessionSummaries>[number]; projectPath: string }[] =
    []
  const allRepeatedReads = new Map<string, RepeatedReadRec>()
  const projectServerNames: string[] = []

  for (const projectPath of projectPaths) {
    const servers = loadProjectMcpConfig(projectPath, globalConfig)
    const serverNames = Object.keys(servers)
    projectServerNames.push(...serverNames)

    const { calls, tokens } = collectToolCallsAndTokens(projectPath, sinceDays)
    tokensThisWindow += tokens
    if (serverNames.length > 0 || calls.size > 0) projectsScanned += 1

    for (const [name, cfg] of Object.entries(servers)) {
      const agg = getOrCreate(serverMap, name, {
        label: name,
        source: 'project',
        alwaysLoad: false,
        killListEligible: true,
        idleConfidence: 'high'
      })
      agg.projects.add(projectPath)
      if (cfg && (cfg as any).alwaysLoad === true) agg.alwaysLoad = true
    }

    for (const [toolName, rec] of calls.entries()) {
      if (!toolName.startsWith('mcp__')) continue
      const [, server, ...rest] = toolName.split('__')
      const agg = getOrCreate(serverMap, server, {
        label: server,
        source: 'unknown',
        alwaysLoad: false,
        killListEligible: false,
        idleConfidence: 'low'
      })
      agg.projects.add(projectPath)
      const shortName = rest.length > 0 ? rest.join('__') : toolName
      agg.toolCalls.set(shortName, (agg.toolCalls.get(shortName) || 0) + rec.calls)
    }

    for (const summary of collectSessionSummaries(projectPath, sinceDays)) {
      allSessionSummaries.push({ summary, projectPath })
    }
    for (const [filePath, rec] of collectRepeatedReads(projectPath, sinceDays)) {
      allRepeatedReads.set(filePath, rec)
    }
  }

  const servers: RealServer[] = [...serverMap.entries()]
    .map(([id, agg]) => {
      const tools: RealTool[] = [...agg.toolCalls.entries()]
        .map(([name, calls]) => ({ name, calls }))
        .sort((a, b) => b.calls - a.calls)
      const totalCalls = tools.reduce((sum, t) => sum + t.calls, 0)
      return {
        id,
        label: agg.label,
        source: agg.source,
        alwaysLoad: agg.alwaysLoad,
        idle: totalCalls === 0,
        idleConfidence: agg.idleConfidence,
        killListEligible: agg.killListEligible,
        totalCalls,
        projectCount: agg.projects.size,
        tools
      }
    })
    .sort((a, b) => b.totalCalls - a.totalCalls)

  const rawSummaries = allSessionSummaries.map((s) => s.summary)
  const costResult = checkCostBreakdown(rawSummaries)
  const cacheResult = checkCacheHealth(rawSummaries)
  const findings = [
    costResult?.finding ?? null,
    cacheResult?.finding ?? null,
    checkClaudeMdBloat(projectPaths),
    checkLongSessions(allSessionSummaries),
    checkRepeatedReads(allRepeatedReads),
    checkMcpCliRedundancy(projectServerNames)
  ].filter((f): f is NonNullable<typeof f> => f !== null)

  const potentialReduction = computePotentialReduction(findings, tokensThisWindow)

  return {
    scannedAt,
    sinceDays,
    projectsScanned,
    servers,
    tokensThisWindow,
    weeklySpendUsd: costResult?.totalUsd ?? null,
    cacheHitRate: cacheResult?.hitRate ?? null,
    findings,
    potentialReduction
  }
}

export function buildDisabledServersSnippet(
  flaggedServerIds: string[]
): Record<string, { disabledMcpjsonServers: string[] }> {
  // Real config lever: ~/.claude.json -> projects[<path>].disabledMcpjsonServers.
  // Only ever matches 'project'-source ids — plugin/connector ids never
  // appear as a literal key in any project's .mcp.json, so passing one here
  // is a safe no-op rather than a wrong snippet.
  const globalConfig = readJsonSafe(path.join(os.homedir(), '.claude.json'))
  const out: Record<string, { disabledMcpjsonServers: string[] }> = {}
  if (!globalConfig?.projects) return out

  for (const [projectPath, entryRaw] of Object.entries(globalConfig.projects)) {
    const entry = entryRaw as any
    const servers = loadProjectMcpConfig(projectPath, globalConfig)
    const already: string[] = entry.disabledMcpjsonServers || []
    const toDisable = flaggedServerIds.filter(
      (id) => Object.prototype.hasOwnProperty.call(servers, id) && !already.includes(id)
    )
    if (toDisable.length > 0) {
      out[projectPath] = { disabledMcpjsonServers: [...already, ...toDisable] }
    }
  }
  return out
}
