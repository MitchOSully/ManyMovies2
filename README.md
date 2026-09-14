# ManyMovies

Desktop app that plays many videos simultaneously in a synced grid.

- **Arbitrary number of videos** — add via the ＋ button or drag-and-drop (files or a folder); remove any tile with its ✕. Videos added mid-session join at the current timeline position.
- **Auto-optimizing grid** — recomputes the best uniform layout on every resize/add/remove; partial last row is centered.
- **One global timeline** — a single slider scrubs every video at once. Videos shorter than the timeline show a `[FINISHED]` card until scrubbed back.
- **Shared transport** — play/pause, ±10s skips, 0.5×/1×/2× speed, mute: all global.
- **Full screen** — F11 or the ⛶ button hides the window frame, the taskbar and the toolbar, leaving nothing but the grid; move the pointer to the bottom edge to slide the toolbar back, F11 or Esc to leave.
- **Click-to-solo audio** — everyone audible by default (highlighted borders). Click a video to hear only it; Ctrl+click to add/remove videos from the audible set; **All sound** restores everyone. Mute is a layer that preserves the set.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | Back / forward 10s |
| ↑ / ↓ | Cycle playback speed |
| M | Mute all |
| A | All sound |
| T | Show / hide titles |
| F11 | Toggle full screen |
| Esc | Leave full screen |

## Development

```
npm install
npm run dev      # dev server + Electron window
npm run build    # portable .exe in release/
```

Supported formats: MP4 (H.264/AAC), WebM, Ogg, and MOV/M4V where Chromium can decode them.
