export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 2 : 0)}`
}

// pct rounds to 0 for a real, nonzero reduction that's just tiny relative to
// a huge window total (e.g. 1.5M reducible out of 650M total) — showing "0%"
// there reads as "nothing found," which misrepresents a real number.
export function formatPct(pct: number): string {
  return pct === 0 ? '<1%' : `${pct}%`
}

export function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  return `${diffHr}h ago`
}
