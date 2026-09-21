// Ported from tool-diet's src/lib/format.js — shared number formatting
// so every finding's pre-rendered detail/fix text reads consistently.

export function fmtTokens(n: number | undefined | null): string {
  const num = n || 0
  const abs = Math.abs(num)
  if (abs >= 1_000_000) {
    const millions = num / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  if (abs >= 1_000) {
    return `${Math.round(num / 1000).toLocaleString()}k`
  }
  return `${Math.round(num)}`
}

export function fmtUsd(n: number | undefined | null): string {
  const num = n || 0
  return `$${num.toFixed(Math.abs(num) < 1 ? 4 : 2)}`
}
