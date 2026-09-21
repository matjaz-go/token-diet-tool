# Tool Diet Audit

A macOS edge-drawer that audits your local [Claude Code](https://claude.com/claude-code)
setup: which MCP servers you configured but never call, what you actually
spent, how healthy your prompt cache is, and where context is being wasted.

A thin handle docks to the right edge of your screen showing "N idle". Click
it to open a dashboard, drill into a server's real called tools, and generate
a config snippet for the servers you want to turn off.

<p align="center"><img src="docs/screenshot.png" alt="Tool Diet Audit dashboard" width="380"></p>

Everything is computed **locally and read-only** from files Claude Code
already writes on your machine. See [Privacy](#privacy).

## Run it

Requires macOS, Node 18+, and Claude Code installed (the scan reads `~/.claude.json`).

```
npm install
npm run dev
```

Click the handle to expand. Click a server's usage bar to drill into its
called tools; "Add to kill list" flags the whole server; the kill-list view
generates a `disabledMcpjsonServers` snippet per affected project, copyable
via "Copy snippet". "Re-scan after restart" clears flags, re-runs the scan and
collapses back to the handle — use it after you've pasted the snippet into
`~/.claude.json` and restarted Claude Code. Right-click the drawer to quit.

`npm run dist:mac` packages an **unsigned, unnotarized** arm64 `.app` (zipped)
into `release/`; `npm run dist:mac:intel` builds x64 for older Intel Macs. Since
it's unsigned, macOS Gatekeeper will require right-click → Open on first launch.

## Privacy

- Read-only. It never modifies your Claude Code config; the kill-list feature
  only *generates* a snippet for you to paste.
- No network access, and it never spawns or executes your configured MCP
  servers. (The MCP↔CLI redundancy check runs `command -v`, a local `$PATH`
  lookup.)
- It reads: `~/.claude.json`, each known project's `.mcp.json` and `CLAUDE.md`,
  installed plugin manifests under `~/.claude/plugins/`, and session logs under
  `~/.claude/projects/**/*.jsonl`. Nothing leaves the process except what the
  UI renders.

## What it shows, and what it deliberately doesn't

Claude Code defers unused tool schemas by default (tool search), and a
permission `deny` rule blocks *execution*, not context *loading*. So a claim
like "87 tools loaded, 19 used, 14k tokens wasted" can't be measured or
delivered honestly from local files. This app only reports numbers it can
actually derive:

| Screen | Shows | Intentionally absent |
|---|---|---|
| Dashboard | MCP servers configured, idle-server count, distinct tools actually called, context-token total for the window (from each session's `usage` block) | "Tools loaded" totals and used/loaded fractions — would require spawning each MCP server to introspect its schema (network + arbitrary code) |
| Drill-down | Real tool names and call counts, parsed from `tool_use` blocks in session logs; `alwaysLoad` misconfiguration flag | Names of idle tools that were never called — unknowable without introspecting the server |
| Kill list | Whole **servers** (the one config lever that exists: `disabledMcpjsonServers`) and a generated per-project snippet | Estimated token savings — replaced with an honest explanation of what disabling an idle server does and doesn't save |

The handle's badge is the number of idle *servers* found on the last scan.

### Three sources of "MCP server"

An MCP server can be available in a Claude Code session in three ways, each
with a different data quality:

| Source | Read from | Idle detection | Kill-list lever |
|---|---|---|---|
| `project` | `.mcp.json` / `~/.claude.json` → `projects[<path>].mcpServers` | High confidence: configured and zero calls | Real: generates a `disabledMcpjsonServers` snippet |
| `plugin` | `~/.claude/plugins/installed_plugins.json`, cross-referenced with each plugin's own bundled `.mcp.json` for its real server name(s) | High confidence: installed and zero calls | Flaggable, but no verified snippet — points to Claude Code's `/plugin` command |
| `connector` | `~/.claude.json` → `claudeAiMcpEverConnected` (Slack, Gmail, Calendar, Drive, …) plus Chrome-extension flags | **Low confidence** — only knows "ever connected", never "currently connected", and only sees usage through Claude Code, not claude.ai web/mobile | Not eligible — managed at claude.ai → Settings → Connectors |

Any `mcp__<x>__<y>` tool call matching none of these still appears
(`source: 'unknown'`) rather than being dropped. Reading each plugin's own
manifest also surfaces redundancy for free, e.g. two installed plugins that
register the same underlying MCP server.

The connector blind spot is real: a connector used heavily from claude.ai's
web or mobile app looks idle here. That's why connectors get
`idleConfidence: 'low'` and are excluded from the kill list entirely.

## Findings

Six checks run across every project Claude Code knows about, listed above the
server list on the dashboard:

| Finding | What it computes | Why |
|---|---|---|
| Cost & models | Weekly $ spend per model at list price; thinking-token share of output | The most tangible number |
| Cache health | `cache_read / (input + cache_read + cache_creation)`; warns under 50% on non-trivial sessions | A cost-per-token signal, not a token reduction |
| CLAUDE.md bloat | Per-project token cost of any CLAUDE.md over 200 lines, loaded into every session there | Move workflow-specific sections into skills |
| Long, low-activity sessions | Cost of sessions open 3h+ with under 2 turns/hour | `/clear` between unrelated tasks |
| Repeated file reads | Token cost of the same file read 3+ times in the window | Summarize or skill-ify the file |
| MCP ↔ CLI redundancy | A configured server (`github`, `vercel`, `stripe`, …) whose CLI is already on `$PATH` | Point CLAUDE.md at the CLI instead |

A headline **potential reduction** banner sums only what is genuinely
reducible and de-duplicated: `repeated-reads`, `claude-md-bloat`, and the
thinking share of `cost-breakdown`. `cache-health` and `long-sessions` have
real `impactTokens` but aren't reducible counts, so they're excluded (see
`computePotentialReduction` in `src/main/lib/checks.ts`). A percentage that
rounds to 0% shows as "<1%", never "0%".

The scan window is anchored to **local midnight** rather than a rolling
`sinceDays × 24h` (`windowCutoff` in `src/main/lib/fsPaths.ts`), so the
numbers hold steady across scans on the same day instead of drifting as old
sessions age out. Not ported: idle skills, hook coverage, daily cost trend,
costliest prompts, subagent usage, rate-limit hits.

Findings logic is adapted from `tool-diet`, the author's companion CLI, and
reimplemented locally so this app stays self-contained.

## How it's built

Electron + Vite (`electron-vite`) + React + TypeScript.

- `src/main/index.ts` — main process. Frameless, transparent, always-on-top
  `BrowserWindow` that resizes between a small handle and the full panel via
  IPC (`window:set-expanded`), always re-docked to the right edge of the
  primary display's work area. Also exposes `scan:run` and `scan:snippet`.
- `src/main/realScan.ts` — orchestrates the scan and builds the
  `disabledMcpjsonServers` snippet.
- `src/main/lib/` — `fsPaths.ts` (path/window helpers), `pricing.ts` (model
  price table), `sessionAnalytics.ts` (session-log parsing), `format.ts`,
  `checks.ts` (the six findings and the headline reduction).
- `src/shared/types.ts` — `ScanResult`/`RealServer`/`Finding` shapes shared by
  main and renderer.
- `src/preload/index.ts` — exposes `window.toolDietBridge` via `contextBridge`.
- `src/renderer/src/` — the React UI; `App.tsx` owns view state
  (`idle | dashboard | drilldown | killlist`), the scan result and the
  kill-list set; `components/` has one file per screen.

Typecheck with `npx tsc --noEmit`. There is no test suite yet.

## Known limitations / roadmap

- Plugins get no real removal snippet, only a pointer to `/plugin`; the exact
  non-interactive uninstall path needs confirming first.
- The scan runs synchronously on the main thread. Fine on demand; move it
  off-thread before running it on a timer.
- Session logs are read three times (tool calls, session summaries, repeated
  reads). A single pass per file would be faster.
- Unsigned and unnotarized builds, no custom icon. Add an `.icns`, an Apple
  Developer ID and notarization (`electron-builder` `afterSign`) before wider
  distribution.
- macOS only. It depends on the Claude Code file layout under `~/.claude`,
  which is not a stable public interface and may change.

## License

[MIT](LICENSE)
