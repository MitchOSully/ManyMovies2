# ManyMovies — Multi-Video Grid Player

## Context

Greenfield Electron desktop app (the `ManyMovies` directory is empty). The user wants a "video wall": play an arbitrary number of videos (typically 5–12 MP4s) simultaneously in a grid, all synced to a single global timeline with one slider, shared transport controls, and a click-to-solo audio model. All design decisions below were confirmed one-by-one in a grilling session.

## Confirmed decisions

| Area | Decision |
|---|---|
| Stack | Electron + vanilla TypeScript + Vite (no UI framework) |
| Ingestion | "Add videos" multi-select file picker + drag-and-drop (files or folders) |
| Mid-session | Add anytime (new video seeks to current global time); per-tile ✕ removes |
| Timeline | All videos aligned at t=0; slider spans 0 → longest duration; scrubbing past a video's end shows its finished card; playback stops at global end |
| FF/RW | ±10s global seeks; separate playback-rate selector (0.5×/1×/2×) applied to all |
| Audio | All audible by default; click = solo that one; Ctrl+click = toggle in/out of audible set; clicking the existing solo does nothing; "All sound" button restores everyone; Mute is a global layer that preserves the audible set |
| Sound highlight | Bright accent border (~3px) on audible tiles; dimmed variant while globally muted |
| Grid | Uniform grid: for N tiles and window size, pick rows×cols maximizing tile area at 16:9 target aspect; letterbox mismatched videos; center the tiles in a partial last row; recompute on resize/add/remove |
| Finished card | Final frame dimmed near-black with small `[FINISHED]` text (no tick) |
| Tile chrome | Persistent filename strip above each video; ✕ at the strip's right end; dark theme |
| Shortcuts | Space play/pause, ←/→ ±10s, ↑/↓ cycle rate, M mute, A all-sound |
| Packaging | electron-builder, portable Windows .exe |
| Persistence | Window size/position only (electron-window-state or manual); grid starts empty each launch |

## Project structure

```
ManyMovies/
  package.json
  electron.vite.config.ts        (or plain vite config + electron-builder config)
  src/
    main/index.ts        — BrowserWindow creation, window-state persistence, file-dialog IPC
    preload/index.ts     — contextBridge: openFileDialog()
    renderer/
      index.html
      style.css          — dark theme, grid, tile chrome, accent borders
      main.ts            — app bootstrap, event wiring, keyboard shortcuts
      player.ts          — VideoTile class: <video> element, finished card, title strip, ✕
      timeline.ts        — global clock: play/pause/seek/rate, slider sync, end-of-longest stop
      layout.ts          — rows×cols optimizer + partial-last-row centering
      audio.ts           — audible-set state, solo/ctrl-click logic, mute layer, border classes
```

Use **electron-vite** (`npm create @quick-start/electron` scaffold, vanilla-ts template) so main/preload/renderer builds are preconfigured, then strip to the structure above.

## Key implementation points

### Global timeline (`timeline.ts`)
- Master clock = `requestAnimationFrame` loop reading the **longest video** as the reference when playing; slider max = `max(video.duration)` across tiles (recomputed on add/remove — removal of the longest video shrinks the slider).
- `seek(t)`: set `video.currentTime = min(t, duration)` on every tile; tiles with `duration < t` enter finished state.
- Drift correction: every ~1s while playing, resync any tile whose `currentTime` deviates > 0.3s from the master clock (skip tiles that are finished/seeking).
- Play/pause/rate fan out to all `<video>` elements; rate selector also scales the drift-check expectations.
- Slider scrubbing while playing: pause fan-out during drag, seek on input events, resume on release.

### Layout (`layout.ts`)
For N tiles in a W×H container: try every rows value 1..N, cols = ceil(N/rows), compute tile size fitting 16:9 within (W/cols)×(H/rows), pick the arrangement with max tile area. Apply via flexbox rows (not CSS grid) so the partial last row centers naturally. Recompute on `ResizeObserver` and add/remove.

### Audio (`audio.ts`)
State: `audibleSet: Set<VideoTile>` (starts = all tiles), `muted: boolean`. Tile volume = `audibleSet.has(tile) && !muted ? 1 : 0` (drive `video.muted`, keep volume at 1). Click handlers per Q6 decisions. New tiles added mid-session join the audible set only if the set currently equals "all" (i.e., no solo active); otherwise they start silent — matches "click always means just this one" mental model. Border CSS classes: `.audible` (accent), `.audible.muted-global` (dimmed accent).

### Finished state (`player.ts`)
On `ended` event or when a seek lands past duration: pause the element at its last frame, overlay a dim scrim with small `[FINISHED]` text. Any seek back below duration removes the overlay and resumes if globally playing.

### Ingestion
- Toolbar "Add videos" → IPC to main → `dialog.showOpenDialog` (multiSelections, filters: mp4/webm/ogg/m4v/mov).
- Drag-and-drop on window: accept files; if a directory is dropped, enumerate its video files (via `webUtils.getPathForFile` + fs readdir through IPC).
- Load via `file://` URLs (or `video.src = URL` from path); new tiles seek to current global time immediately after `loadedmetadata`.

### Control bar (bottom)
`[▶/⏸] [⏪10] [10⏩] [rate: 0.5×|1×|2×] [🔇] [All sound]  ——slider——  mm:ss / mm:ss`

### Packaging & persistence
- electron-builder config: `win.target: "portable"` → single portable .exe via `npm run build`.
- Window bounds saved to `userData` JSON on close, restored on launch (validate against current display bounds).

## Build order

1. Scaffold electron-vite vanilla-ts project; dark-theme shell with empty-state "Add videos / drop files here".
2. Ingestion (picker + drag-drop) and `VideoTile` with title strip + ✕.
3. Layout engine with resize handling.
4. Global timeline: slider, play/pause, seeks, rate, drift correction, finished cards.
5. Audio model: solo/ctrl-click/all-sound/mute + border highlights.
6. Keyboard shortcuts.
7. Window-state persistence; electron-builder portable .exe; end-to-end test with real MP4s.

## Verification

- `npm run dev`, drop in 5–12 MP4s of mixed durations/aspect ratios (generate short test clips with ffmpeg if needed: varying lengths 5s/10s/20s, one portrait).
- Check: grid re-optimizes on resize and add/remove; partial row centered; scrub slider past shortest video → `[FINISHED]` card appears, scrub back → revives; play to global end → playback stops.
- Audio: click tile A (only A audible, accent border), click B (switches), Ctrl+click A (both), All sound (everyone), Mute (silence, dimmed borders), unmute (exact set restored).
- Shortcuts: Space/←/→/↑/↓/M/A.
- Drive the app UI via the browser/automation tooling where possible; visually confirm sync (all videos showing same scene position after seeks and after 60s of playback).
- `npm run build` → run the portable .exe from `dist/`, confirm it launches, remembers window bounds across restarts.