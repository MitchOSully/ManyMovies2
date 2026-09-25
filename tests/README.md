# ManyMovies test suite

```bash
npm test            # unit + E2E (builds first) — run after every change, ~2 min
npm run test:unit   # Vitest only, well under a second
npm run test:e2e    # electron-vite build + Playwright
npx playwright test collapse          # one spec file
npx playwright test -g "slider"       # tests whose title matches
npm run test:fixtures -- --force      # regenerate the clips
```

**Requires `ffmpeg` on PATH** (`winget install ffmpeg`). Fixtures are generated on first run into `tests/fixtures/out/` (gitignored) and rebuilt only when a recipe in [fixtures/generate.mjs](fixtures/generate.mjs) changes.

## Layout

| Path | What |
|---|---|
| `unit/` | Vitest: `computeLayout` and `AudioController` in isolation |
| `e2e/*.spec.ts` | Playwright driving the real built Electron app, one app instance per file |
| `e2e/helpers.ts` | `useApp()` (launch/reset/failure dump), `load()`, state readers |
| `e2e/tolerances.ts` | Every timing tolerance, in one place |
| `fixtures/generate.mjs` | Synthetic clips: mixed durations, portrait, end-`moov`, no/AC-3 audio, webm/mkv/mov, a broken file, 9 clips for the >6-connection case, 14 × 30 MB clips for the >10-request case |

## How the E2E tests work

- The app runs from `out/` with `MM_USER_DATA` pointing at a temp profile, so your real window state and last folder are never touched.
- Windows are **visible** (1280×800). Playwright's input doesn't need OS focus, so you can keep working, but windows will pop up. Full-screen tests briefly cover the screen.
- Videos are added through `window.mm.addSources` + the real `mediaUrls` IPC (the same path `addPaths` takes). Everything a user does (buttons, keys, slider drags, tile clicks, ✕) uses real input. Assertions read DOM classes and `<video>` state, not pixels.
- On failure, `test-results/<test>/` gets `failure.png` and `tiles.json` (per-tile readyState, buffered ranges, decoded byte counts).

Workarounds worth knowing:
- **F11** belongs to Electron's default-menu accelerator, which Playwright's key events never reach, so the test sends it with `webContents.sendInputEvent`.
- **Minimized/hidden**: Playwright keeps the page "visible" even when the window is minimized. `hidden.spec.ts` forces `document.hidden` and parks rAF instead, which leaves only the 250 ms interval running, just like a real minimize.
- **The file picker** is stubbed in the main process (`dialog.showOpenDialog`) so the ＋ button → IPC → `lastFolder` path is tested without the native UI.
- **The browser-only path** (no `window.api`) is tested by opening the built renderer in a second Electron window without the preload.

## Rules

- **No retries.** A sync test that passes on retry is an intermittent drift or starvation bug. Fix the wait or the tolerance properly instead.
- **Poll, don't sleep.** Use `expect.poll` or `waitForFunction`. A fixed wait only belongs where the passing of time is itself under test.
- **Tests that expose a real app bug** assert the *correct* behaviour and are marked `test.fail()` with a comment naming the bug. They flip to an error once it's fixed, which tells you to remove the marker.

## Manual checklist (not automatable)

After changes to ingestion or the grid animation, check these by hand in `npm run dev`:

- [ ] The native ＋ Add videos dialog opens, filters to video types and starts in the last-used folder
- [ ] Dragging files from Explorer adds them; dragging a **folder** adds its videos
- [ ] A video finishing mid-playback shrinks away smoothly, and the survivors glide into their new cells (no jump, no flash)
