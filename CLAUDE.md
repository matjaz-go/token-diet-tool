# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope

macOS Electron prototype, "Tool Diet Audit": an edge-docked drawer that scans this machine's own Claude Code config and session logs and reports idle MCP servers plus token/cost findings. Electron + Vite + React + TypeScript.

`README.md` is detailed and current on product decisions (what is real vs. deliberately dropped, the three server sources, the findings table, roadmap). Read it before changing scan semantics.

## Commands

```
npm install
npm run dev              # electron-vite dev, hot-reloads renderer
npm run build            # electron-vite build -> out/
npm run dist:mac         # unsigned arm64 .app zip -> release/ (default target)
npm run dist:mac:intel   # x64 build; only for an Intel Mac (Rosetta on Apple Silicon is visibly janky)
npx tsc --noEmit         # typecheck (no script defined; currently clean)
```

There is no test runner and no linter configured. `out/` and `release/` are gitignored build output.

## Architecture

Standard three-process Electron layout, wired through `electron.vite.config.ts` (main and preload are separate bundles; preload is forced to CJS, and the renderer's root is `src/renderer`).

- **`src/main/`** — all real work happens here. `realScan.ts` (`runScan`) does a synchronous, read-only pass over `~/.claude.json`, each known project's `.mcp.json`/`CLAUDE.md`, `~/.claude/plugins/`, and `~/.claude/projects/**/*.jsonl`. `lib/checks.ts` holds the six findings plus `computePotentialReduction`; `lib/sessionAnalytics.ts` parses session logs; `lib/fsPaths.ts` owns the project-path → session-dir mapping and the scan window; `lib/pricing.ts` is the model price table. `index.ts` owns the window and the IPC handlers.
- **`src/preload/index.ts`** — the only bridge: exposes `window.toolDietBridge` via `contextIsolation`. Adding a capability means touching **three places**: an `ipcMain.handle` in `main/index.ts`, the `contextBridge` entry in `preload/index.ts`, and the typing in `renderer/src/types.d.ts`.
- **`src/shared/types.ts`** — `ScanResult`/`RealServer`/`Finding` shapes imported by both main and renderer. Findings arrive with `detail`/`fix` text **pre-rendered in main**; the renderer only displays them.
- **`src/renderer/src/`** — `App.tsx` owns all state (`view: idle | dashboard | drilldown`, the `ScanResult`); `components/` is one file per screen.

## Non-obvious constraints

- **Window geometry is load-bearing.** The `BrowserWindow` is frameless/transparent/always-on-top, docked to the right edge of the primary display's `workArea`. Only *width* changes between handle (64) and panel (460) via `window:set-expanded`; height is deliberately constant so the native resize animation is purely horizontal. Don't make height vary. The CSS `.handle` width (52px) and the 12px slack in `HANDLE_WIDTH` are coupled.
- **Read-only, no network, no spawning.** The scan must never call the network or execute a configured MCP server (inspecting a server's tool schema would require it, which is why "tools loaded" totals and idle tool names are intentionally absent). This is a permanent design commitment, not a limitation to work around. The MCP↔CLI check's `command -v` is a PATH lookup only. The one sanctioned exception is `connect:open` in `main/index.ts`, which opens a **fixed, hardcoded** GitHub Discussion URL via `shell.openExternal` — it takes no argument from the renderer and never transmits scan data. If this ever grows into a real comparison feature (an actual upload of stats), that needs its own explicit opt-in gate and its own privacy review — don't fold it into the always-on scan path.
- **Three server sources with different guarantees** (`ServerSource` in `types.ts`): `project` (high-confidence idle detection), `plugin` (high-confidence idle detection), `connector` (low-confidence — only knows "ever connected"). Preserve `idleConfidence` when adding sources. There is no config-mutation feature in this app (no kill list) — it's read-only end to end; don't reintroduce a "generate a snippet to disable X" flow without treating it as a new, deliberate feature.
- **`windowCutoff` is midnight-anchored, not rolling** — a deliberate divergence from the `tool-diet` CLI this logic was ported from, so numbers won't match `tool-diet --since-days` exactly.
- **`projectKey` encodes both `/` and `.` as `-`** to locate `~/.claude/projects/<key>/`; get this wrong and a project silently shows zero sessions.
- **Only `repeated-reads`, `claude-md-bloat`, and the thinking share of `cost-breakdown` count toward the headline "potential reduction"**; `cache-health` and `long-sessions` have `impactTokens` but are not reducible counts. See the comment on `computePotentialReduction`.
- Known perf debt: `collectToolCallsAndTokens`, `collectSessionSummaries`, and `collectRepeatedReads` each re-read every session file, and the scan runs on the main thread. Fine on demand; move off-thread before scanning on a timer.
