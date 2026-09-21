// Shared filesystem helpers used by every real-data module (realScan.ts,
// sessionAnalytics.ts). Kept in one place so the project-path -> session-log
// mapping and the windowing rule are defined exactly once.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function claudeHome(): string {
  return path.join(os.homedir(), '.claude')
}

// Claude Code encodes a project's session directory by replacing path
// separators AND dots with '-' (e.g. /Users/x/web/my.app ->
// -Users-x-web-my-app, not -my.app).
export function projectKey(cwd: string): string {
  return cwd.replace(/[/\\.]/g, '-')
}

export function readJsonSafe(p: string): any {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

export function listSessionFiles(cwd: string): string[] {
  const dir = path.join(claudeHome(), 'projects', projectKey(cwd))
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(dir, f))
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Midnight-anchored, not a rolling `sinceDays * 24h` from the exact instant
// of the scan. A pure rolling window drifts on every scan as old sessions
// age out of it, second by second, which reads as an unexplained decrease
// between two scans minutes apart. This holds steady across scans on the
// same day and only moves once, at local midnight — trading rolling
// precision for a number that doesn't shift under you mid-session. (Diverges
// from tool-diet's own `Date.now() - sinceDays*24h` formula for the same
// --since-days value — a deliberate choice, not an oversight.)
export function windowCutoff(sinceDays: number): number {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  return startOfToday.getTime() - (sinceDays - 1) * MS_PER_DAY
}

export function loadProjectMcpConfig(cwd: string, globalConfig: any): Record<string, any> {
  const projectFile = readJsonSafe(path.join(cwd, '.mcp.json'))
  const servers: Record<string, any> = { ...(projectFile?.mcpServers || {}) }
  const projectEntry = globalConfig?.projects?.[cwd] || {}
  Object.assign(servers, projectEntry.mcpServers || {})
  return servers
}
