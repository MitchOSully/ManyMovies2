# ManyMovies — agent orientation

Electron desktop app (Windows-first) that plays **many videos at once in a synced grid**: one global timeline/slider, shared transport, click-to-solo audio. Vanilla TypeScript — **no framework, no bundler config beyond electron-vite defaults, no test suite, no linter**. ~1250 lines total; read the whole of any file you touch.

## Commands

```bash
npm run dev      # electron-vite dev: Vite renderer on :5173 + Electron window
npm run build    # → release/ManyMovies <version>.exe (electron-builder portable)
```

No test/lint/typecheck script exists. `npx tsc --noEmit` type-checks (`tsconfig.json` is `noEmit`, strict). `.claude/launch.json` defines a `dev` preview config (needs the explicit Node PATH prefix it contains).

## Map

| File | Role |
|---|---|
| [src/main/index.ts](src/main/index.ts) | Electron main: per-file loopback HTTP media servers, window-state persistence, file-dialog/folder-expansion IPC, `MM_*` test hooks |
| [src/preload/index.ts](src/preload/index.ts) | `contextBridge` → `window.api` (openFiles, expandPaths, mediaUrls, pathForFile, onAutoload). Types in [src/renderer/env.d.ts](src/renderer/env.d.ts) |
| [src/renderer/main.ts](src/renderer/main.ts) | Bootstrap: DOM wiring, ingestion (picker/drag-drop), transport buttons, keyboard shortcuts, rAF UI loop |
| [src/renderer/player.ts](src/renderer/player.ts) | `VideoTile` — builds one tile's DOM (`<video>`, title strip + ✕, hover ✕/title, `[FINISHED]` and `[CAN'T PLAY]` overlays) |
| [src/renderer/timeline.ts](src/renderer/timeline.ts) | `Timeline` — global clock: play/pause/seek/rate, drift correction, finished-state upkeep |
| [src/renderer/audio.ts](src/renderer/audio.ts) | `AudioController` — audible set, solo / ctrl-click toggle / all-sound / global mute |
| [src/renderer/layout.ts](src/renderer/layout.ts) | `computeLayout(n, w, h, stripHeight)` — picks the rows×cols maximizing 16:9 tile area |
| [src/renderer/style.css](src/renderer/style.css) | Dark theme; all tile-state styling is class-driven (see below) |
| [src/renderer/index.html](src/renderer/index.html) | Static shell; every control has a fixed `id` that `main.ts` looks up |

[README.md](README.md) = user-facing feature/shortcut list. [FirstPlan.md](FirstPlan.md) = original design doc, archived; **it has drifted from the code** — trust the source.

## Architecture notes (the non-obvious parts)

- **Videos are served over `http://127.0.0.1:<port>/<token>`, not `file://` or a custom protocol.** Chromium only treats http(s) as range-seekable, and trailing-`moov` files need a tail seek to demux at all. Each file gets its **own server on its own port** because Chromium caps HTTP/1.1 at 6 connections per origin — a shared port black-tiled/froze every video past the sixth. Don't "simplify" this back to one server (`src/main/index.ts:20-30`).
- **Timeline reference clock** is the *longest video that is actually advancing* — healthy (`readyState >= 3`) and within `CLOCK_TRUST_WINDOW` of the last known global time. Stalled tiles freeze alone and get snapped forward on recovery; they never drag the wall backward. Drift correction runs ~1/s while playing.
- **The rAF loop is duplicated by a 250 ms `setInterval`** (`main.ts:240`) so timeline logic survives a minimized window.
- **Tile state is expressed as CSS classes** set from TS: `.finished`, `.load-error`, `.audible`, `.muted-global`, and `.no-strips` on `#tiles` for the Titles toggle. Layout is fed through `--tile-w`/`--tile-h` custom properties plus an explicit `#tiles` width, so a partial last row centers.
- **"All sound" is judged by the set, not how it was reached** — hand-assembling the full set via ctrl+clicks re-enters all-mode, and borders only show when a strict subset is soloed.
- Browser-only fallback path exists (`addBrowserFiles`, blob URLs) for when `window.api` is absent; keep both paths working.

## Verifying changes

No automated tests. Use the `MM_*` env hooks in `src/main/index.ts:206-252` with clips from `testdata/` (gitignored; `ABC Tests/` = short synthetic set, `Problem Tests/` = known-awkward files):

- `MM_AUTOLOAD=<dir-or-file;...>` load on startup · `MM_AUTOPLAY=1` play after 1.5 s
- `MM_SHOT=<delayMs>:<png>[;...]` screenshot · `MM_REPORT=<delayMs>:<json>` dump per-tile decoder state (readyState, buffered, decoded bytes) · `MM_EVAL=<delayMs>:<js>` run JS in the renderer
- `window.mm = { addSources, removeTile, timeline, audio, tiles, toggleTitles }` is exposed for driving the renderer directly.

Regression watchlist: >6 simultaneous videos (connection starvation), end-`moov` files, mixed durations (`[FINISHED]` in/out), portrait clips, `.mov` files Chromium may refuse (`[CAN'T PLAY]` overlay).
