// Real-data shapes produced by src/main/realScan.ts. Every number here comes
// from this machine's own ~/.claude.json, .mcp.json files, installed-plugin
// manifests, and session logs under ~/.claude/projects/**/*.jsonl — nothing
// fabricated, nothing fetched over the network.
//
// Deliberately NOT included: a per-server "total tools loaded" count, or the
// names of specific tools that were never called. Getting either would mean
// spawning the user's configured MCP server processes to introspect their
// schema — network calls + arbitrary code execution — which tool-diet (the
// CLI this reuses the logic of) treats as a non-goal. See
// tool-diet/README.md, "What this is not".

export interface RealTool {
  name: string
  calls: number
}

// Three genuinely different data qualities, not one:
// - 'project'   classic .mcp.json / ~/.claude.json project config. Full real
//               idle detection, and a real local disable lever
//               (disabledMcpjsonServers).
// - 'plugin'    installed via ~/.claude/plugins/installed_plugins.json, with
//               its MCP server name(s) read from that plugin's own bundled
//               .mcp.json. Real idle detection (installed + call count), but
//               no verified local disable snippet — management happens
//               through Claude Code's own plugin system, not a config edit
//               this app can safely generate.
// - 'connector' claude.ai account-level connectors (Slack, Gmail, Google
//               Calendar/Drive, Claude Docs, Chrome). Only "ever connected"
//               is knowable locally (~/.claude.json's
//               claudeAiMcpEverConnected) — not "currently connected" — and
//               there's no local file that disables one; that's an
//               account-settings action. Shown for visibility, never
//               kill-list eligible.
export type ServerSource = 'project' | 'plugin' | 'connector' | 'unknown'

export interface RealServer {
  id: string
  label: string
  source: ServerSource
  alwaysLoad: boolean
  idle: boolean
  idleConfidence: 'high' | 'low'
  killListEligible: boolean
  totalCalls: number
  projectCount: number
  tools: RealTool[]
}

// One check's result, mirroring tool-diet's own finding shape (same ids,
// same "only claim impactTokens when a check actually computed one" rule).
// Every number and every word of `detail`/`fix` is pre-rendered in the main
// process from real local data — the renderer just displays them.
export type FindingId =
  | 'cost-breakdown'
  | 'cache-health'
  | 'claude-md-bloat'
  | 'long-sessions'
  | 'repeated-reads'
  | 'mcp-cli-redundancy'

export interface Finding {
  id: FindingId
  label: string
  status: 'ok' | 'warn' | 'info'
  impactTokens?: number
  impactUsd?: number
  recommendText?: string
  detail: string
  fix?: string[]
}

export interface PotentialReduction {
  totalTokens: number
  pct: number
  contributors: FindingId[]
}

export interface ScanResult {
  scannedAt: number
  sinceDays: number
  projectsScanned: number
  servers: RealServer[]
  tokensThisWindow: number
  weeklySpendUsd: number | null
  cacheHitRate: number | null
  findings: Finding[]
  potentialReduction: PotentialReduction | null
  error?: string
}
