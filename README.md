# ManyMovies

Desktop app that plays many videos simultaneously in a synced grid.

- **Arbitrary number of videos** — add via the ＋ button or drag-and-drop (files or a folder); remove any tile with its ✕, or all of them with the toolbar's ✕ (Clear). Videos added mid-session join at the current timeline position.
- **Auto-optimizing grid** — recomputes the best uniform layout on every resize/add/remove; partial last row is centered.
- **One global timeline** — a single slider scrubs every video at once. A video that reaches its end shrinks away and the grid re-flows, so the rest get bigger; scrub back before its end and it returns to the same slot. Once nothing is left running, every video reappears on its final frame.
- **Shared transport** — play/pause, ±10s skips, 0.5×/1×/2× speed, mute: all global. The toolbar keeps just add, clear, play/pause, the slider and full screen in view; the › button slides out the rest (±10s, speed, mute, All sound, Titles) and ‹ tucks them away again. While they're tucked away, › lights up if you've muted or changed the speed.
- **Full screen** — F11 or the full-screen button hides the window frame, the taskbar and the toolbar, leaving nothing but the grid; move the pointer to the bottom edge to slide the toolbar back, F11 or Esc to leave.
- **Float a video** — the float (picture-in-picture) button on a tile moves that video into its own window (e.g. for a projector or second monitor) and the grid closes up around it. The float has no controls: the main toolbar and all keyboard shortcuts still drive it, and they work while the float has focus too. F11 in the float makes it full screen on whatever monitor it's on, and Esc leaves. Click it to solo its audio, or Ctrl+click it like a grid tile. Close the window to put the video back in the grid. The next float opens where the last one was closed. Floating or docking restarts that one video's stream, so it blanks for about a second before re-joining in sync.
- **Click-to-solo audio** — everyone audible by default (highlighted borders). Click a video to hear only it; click an audible video again to turn it back off (turning off the last one brings everyone back); Ctrl+click to add/remove videos from the audible set; **All sound** restores everyone. Mute is a layer that preserves the set.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | Back / forward 10s |
| ↑ / ↓ | Cycle playback speed |
| M | Mute all |
| A | All sound |
| T | Show / hide titles |
| F11 | Toggle full screen (of the float, when a float window has focus) |
| Esc | Leave full screen |

## Development

```
npm install
npm run dev      # dev server + Electron window
npm run build    # portable .exe in release/
npm test         # full regression suite (needs ffmpeg on PATH)
```

Supported formats: MP4 (H.264/AAC), WebM, Ogg, and MOV/M4V where Chromium can decode them.
