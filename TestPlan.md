# ManyMovies regression test suite

## Context
ManyMovies has no automated tests; regressions are caught by hand with `MM_*` env hooks and `testdata/` clips (gitignored, local-only, up to 12 GB). Goal: a suite you (and I) run via `npm test` after every change, covering every feature so far. Decisions from the grilling session:

1. Two tiers: **Playwright `_electron` E2E** (main suite) + **Vitest** unit tests for pure logic.
2. Fixtures: **committed ffmpeg generator**, output to gitignored dir, generated on demand.
3. **`npm test` runs everything, manually** — no git hook, no CI. `npm run test:unit` for quick loops.
4. **Visible windows**, fixed 1280×800, one app instance per spec file, serial, isolated user-data dir.
5. **Real input first**: loading via `window.mm.addSources`/IPC (dialog + OS drag-drop are manual-only); actions via real clicks/keys/slider drags; asserts on DOM/video state, screenshots only on failure.
6. Scope = full inventory below + one browser-fallback smoke test.
7. App changes: **only env-gated hooks in `src/main/index.ts`** (just `MM_USER_DATA`); ask before anything else.
8. Poll-not-sleep, named tolerances, **zero retries**, failure artefacts (screenshot + per-tile decoder dump).
9. Tests exposing real app bugs: assert correct behaviour, mark `test.fail()` with a comment, list them at the end — **no app fixes** in this work.

## Files

### App change (only one)
- `src/main/index.ts` — top-level, before `app.whenReady()`: `if (process.env.MM_USER_DATA) app.setPath('userData', process.env.MM_USER_DATA)`. Document next to the other `MM_*` hooks.

### Tooling
- `package.json` — devDeps `@playwright/test`, `vitest`; scripts:
  - `test` → `npm run test:unit && npm run test:e2e`
  - `test:unit` → `vitest run`
  - `test:e2e` → `electron-vite build && playwright test`
  - `test:fixtures` → `node tests/fixtures/generate.mjs`
- `.gitignore` — add `tests/fixtures/out/`, `test-results/`, `playwright-report/`.
- `playwright.config.ts` — `testDir: tests/e2e`, `workers: 1`, `retries: 0`, `fullyParallel: false`, `globalSetup` = fixture generation, screenshot `only-on-failure`, per-test timeout ~30 s.
- `vitest.config.ts` — `include: tests/unit/**`.
- `tsconfig.json` — include `tests` (so `npx tsc --noEmit` covers them).

### Fixtures — `tests/fixtures/generate.mjs`
ffmpeg (`testsrc2` + burned-in timecode via `drawtext`, `sine` tone), idempotent (skip existing files; hash of the recipe list in a stamp file to regenerate on change). Output `tests/fixtures/out/`:
- `d3.mp4`, `d5.mp4`, `d8.mp4`, `d12.mp4` — H.264/AAC faststart, mixed durations
- `d5b.mp4` — ends within ~0.1 s of `d5` (simultaneous-finish case)
- `portrait6.mp4` — 720×1280
- `endmoov8.mp4` — no `+faststart` (moov at tail)
- `noaudio5.mp4` — no audio track; `ac3audio5.mp4` — AC-3 audio (undecodable → NO AUDIO badge)
- `clip6.webm` (VP9/Opus), `clip6.mkv` (H.264/AAC), `clip6.mov`
- `broken.mp4` — random bytes (→ `[CAN'T PLAY]`, duration 0)
- `many/` — 9 × 10 s clips (>6-connection starvation)
- `folder/` — mix of video + `notes.txt` + `image.png` + nested subdir (expandPaths filtering)
Fail fast with a clear message if `ffmpeg` isn't on PATH.

### Harness — `tests/e2e/helpers.ts`
- `launchApp()` — fresh temp dir, seeds `window-state.json` `{width:1280,height:800}`, launches `_electron.launch({ args: ['out/main/index.js'], env: { MM_USER_DATA } })`, returns `{ app, page, userData }`.
- `loadFixtures(page, names)` — `page.evaluate` → `window.api.mediaUrls(paths)` → `window.mm.addSources(...)` (mirrors `addPaths` in `src/renderer/main.ts`); waits until all tiles have metadata or error.
- State readers: `tileStates(page)` (classes, rect, currentTime, paused, rate, muted, readyState, error, duration), `timelineTime(page)`, `timeText(page)`.
- `waitAllReady(page)`, `waitTime(page, t)` via `expect.poll`.
- `test.afterEach` failure hook: screenshot + decoder dump (same fields as the `MM_REPORT` code in `src/main/index.ts`) into `testInfo.outputPath()`.
- `tests/e2e/tolerances.ts` — `SYNC_SPREAD=0.15`, `CLOCK_RATE=±10%/3s`, `SEEK=0.1`, `DRIFT_RECOVERY_MS=2000`, plus readiness/load timeouts.

### Unit tests — `tests/unit/`
- `layout.test.ts` — `computeLayout` (`src/renderer/layout.ts`): n=1..12 cols/rows choices at 1280×~740, strip on/off, never exceeds container, portrait-ish/very-wide containers, n=0 fallback.
- `audio.test.ts` — `AudioController` (`src/renderer/audio.ts`) with fake tiles (`{ video: {muted, volume}, el: { classList } }` using a tiny Set-backed classList): default all-audible/no borders, solo, ctrl-toggle, hand-assembled full set re-enters all-mode (and new tiles then join), removing last audible → all sound, mute preserves set, `isAllSound`.

### E2E specs — `tests/e2e/*.spec.ts` (one app instance per file)
1. `ingestion.spec.ts` — empty state shown/hidden; add N; mid-session add joins at current time (and past-its-end add arrives finished/collapsed); `expandPaths` via `window.api.expandPaths` on `folder/` filters extensions, skips missing paths, no recursion; webm/mkv/mov load.
2. `media-server.spec.ts` — 9 tiles all `readyState ≥ 3` and advancing after play; end-moov plays and seeks; Node `fetch` against a URL from `mediaUrls`: full 200, `bytes=0-99` → 206 + headers, suffix `bytes=-100`, open-ended, out-of-range → 416, wrong token → 404, same path → same URL.
3. `layout.spec.ts` — tile sizes/cols match `computeLayout` for 1..7 tiles; partial last row centred; `setSize` resize relayouts; Titles via button and `T` toggles `#tiles.no-strips` + shrinks tiles by strip; portrait fits in cell.
4. `transport.spec.ts` — play/pause via button + Space (`.playing` class, all videos unpaused); ±10 s via buttons + arrows, clamps at 0/duration; rate select + ↑/↓ clamped at 0.5/2 and applied to every video; `#time` text format; slider drag (mouse down/move/up on `#slider`): paused during drag, play button keeps showing playing, resumes on release; play at end restarts from 0; end-of-timeline auto-pause.
5. `sync.spec.ts` — after 3 s at 1×, spread < `SYNC_SPREAD`; timeline advances at wall rate; nudge one tile by +1 s → corrected within `DRIFT_RECOVERY_MS`; same at 2×.
6. `collapse.spec.ts` — shortest finishes → `.finished.collapsed`, remaining tiles grow; `.exiting` observed during playback; scrub back → reappears in original DOM slot, no `.exiting` while scrubbing; `d5`+`d5b` finish together cleanly (both collapsed, no stranded transforms/`.exiting`); all finished → every tile revealed; `broken.mp4` present doesn't suppress reveal.
7. `audio.spec.ts` — real clicks on `.frame`: default all audible, no `.audible` borders; click solos (muted flags + border); ctrl+click add/remove; hand-assemble full set → borders gone, `#btn-all.active`; `A` + button restore; `M` + button mute keeps set, `.muted-global`, `#btn-all.active-dim`, icon swap.
8. `errors.spec.ts` — `broken.mp4` → `.load-error` + detail text; `noaudio5`/`ac3audio5` get `.no-audio` after ~1.5 s played, `d5` never does.
9. `remove.spec.ts` — strip ✕ (titles on) and hover `.frame-close` (titles off) remove tile + relayout; timeline/audio forget it; removing all → empty state, timeline reset.
10. `fullscreen.spec.ts` — ⛶ button, F11 (real key → menu accelerator), Esc: `body.fullscreen` + `BrowserWindow.isFullScreen()` via `app.evaluate`; mouse near bottom → `.show-controls`, away → hidden.
11. `hidden.spec.ts` — `win.minimize()` via `app.evaluate` while playing; after N s restore: timeline advanced, short clip finished/collapsed (snapped, no `.exiting` left).
12. `persistence.spec.ts` — resize/move, close, relaunch same user-data → bounds restored; off-screen saved position → dropped; corrupt/BOM JSON tolerated; `settings.json` `lastFolder` round-trip (seeded file read back via relaunch; dialog itself not opened).
13. `browser-fallback.spec.ts` — plain Playwright Chromium against `vite preview` of the built renderer (or `file://out/renderer/index.html`), no `window.api`: `setInputFiles('#file-input', [d3, d5])` → tiles play.

### Docs
- `tests/README.md` — how to run, fixture requirements (ffmpeg), tolerances philosophy, `test.fail()` convention, **manual checklist**: native picker, OS drag-drop (files + folder), FLIP animation smoothness.
- `CLAUDE.md` — replace "no test suite" wording; commands gain `npm test`/`test:unit`; "Verifying changes" says run `npm test` after every change; mention `MM_USER_DATA`.
- `README.md` Development section — add `npm test`.

## Verification
1. `npx tsc --noEmit` clean.
2. `npm run test:fixtures` produces the set; `ffprobe` spot-check end-moov/AC-3/portrait.
3. `npm test` end-to-end; target < 3 min. Run it 3× consecutively to confirm zero flakes with no retries.
4. Mutation sanity checks (temporary, reverted): break one thing per area (e.g. single shared media server port → starvation test fails; drop `.collapsed` toggle → collapse test fails; swap `solo`/`toggleInSet` → audio test fails; remove Space case → transport fails) to prove the tests bite.
5. Report: pass counts, runtime, and every `test.fail()`-marked app bug found.
