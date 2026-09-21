// List prices in USD per million tokens. Ported from tool-diet's
// src/lib/pricing.js — same table, same caveats.
// Source: https://platform.claude.com/docs/en/about-claude/pricing
// Fetched 2026-09-16. Anthropic can change these; this table is not live.
// A user on contracted/org rates (Claude Code's `modelPricing` managed
// setting) will see a different real bill than this estimate — same
// caveat Claude Code's own /usage carries.

export interface ModelPrice {
  input: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
  output: number
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-sonnet-5': { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
  'claude-opus-5': { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  'claude-haiku-4-5': { input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 },
  'claude-fable-5-1': { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50 }
}

// Session logs sometimes carry a date-suffixed model id
// (e.g. claude-haiku-4-5-20251001); match by prefix, longest key first so a
// more specific id never loses to a shorter unrelated one.
const KEYS_BY_LENGTH = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length)

export function priceFor(modelId: string | null | undefined): ModelPrice | null {
  if (!modelId) return null
  if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId]
  const key = KEYS_BY_LENGTH.find((k) => modelId.startsWith(k))
  return key ? MODEL_PRICING[key] : null
}

export interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation5m: number
  cacheCreation1h: number
  thinking?: number
}

export interface CostBreakdown {
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
  total: number
}

// Per-category cost breakdown in USD, so "how much was input vs. cache vs.
// output" is answerable, not just a single total.
export function estimateCostBreakdown(modelId: string, usage: ModelUsage): CostBreakdown | null {
  const p = priceFor(modelId)
  if (!p) return null
  const m = (n: number | undefined) => (n || 0) / 1_000_000
  const input = m(usage.input) * p.input
  const cacheWrite = m(usage.cacheCreation5m) * p.cacheWrite5m + m(usage.cacheCreation1h) * p.cacheWrite1h
  const cacheRead = m(usage.cacheRead) * p.cacheRead
  const output = m(usage.output) * p.output
  return { input, cacheWrite, cacheRead, output, total: input + cacheWrite + cacheRead + output }
}

export function estimateCostUsd(modelId: string, usage: ModelUsage): number | null {
  const breakdown = estimateCostBreakdown(modelId, usage)
  return breakdown ? breakdown.total : null
}
