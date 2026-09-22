import { VideoTile, type VideoSource } from './player'
import { Timeline } from './timeline'
import { AudioController } from './audio'
import { computeLayout, TILE_GAP, STRIP_HEIGHT } from './layout'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const stage = $<HTMLDivElement>('stage')
const tilesEl = $<HTMLDivElement>('tiles')
const emptyEl = $<HTMLDivElement>('empty')
const btnAdd = $<HTMLButtonElement>('btn-add')
const btnPlay = $<HTMLButtonElement>('btn-play')
const btnBack = $<HTMLButtonElement>('btn-back')
const btnFwd = $<HTMLButtonElement>('btn-fwd')
const rateSel = $<HTMLSelectElement>('rate')
const btnMute = $<HTMLButtonElement>('btn-mute')
const btnAll = $<HTMLButtonElement>('btn-all')
const btnTitles = $<HTMLButtonElement>('btn-titles')
const btnFull = $<HTMLButtonElement>('btn-full')
const slider = $<HTMLInputElement>('slider')
const timeEl = $<HTMLSpanElement>('time')
const fileInput = $<HTMLInputElement>('file-input')

const RATES = [0.5, 1, 2]
/** Duration of the collapse animation; must match the .flip transition in the CSS. */
const EXIT_MS = 180
const tiles: VideoTile[] = []
const timeline = new Timeline()
const audio = new AudioController()
/** Title strips above each video; hiding them gives the grid their height back. */
let titlesVisible = false
/** Stamp length the time readout's width reserve was last measured for. */
let timeReserve = 0
/** Hidden twin of the readout (see #time-probe in the CSS) used to measure it. */
const timeProbe = document.createElement('span')
timeProbe.id = 'time-probe'
timeProbe.setAttribute('aria-hidden', 'true')
timeEl.after(timeProbe)

// --- tile management ---

function addSources(sources: VideoSource[]): void {
  for (const s of sources) {
    const tile = new VideoTile(s)
    tile.onClickVideo = (t, ctrl) => (ctrl ? audio.toggleInSet(t) : audio.solo(t))
    tile.onClose = removeTile
    // Never relayout straight from here: tick() can finish several tiles in one
    // pass, so the work is coalesced into a single pass in step().
    tile.onFinishedChange = () => {
      layoutDirty = true
    }
    // Duration feeds the collapse rule too, and it arrives (or never does) after
    // the tile is built — adding a video once everything has finished has to
    // re-collapse the rest, and no finished state flips to say so.
    for (const ev of ['loadedmetadata', 'error']) {
      tile.video.addEventListener(ev, () => {
        layoutDirty = true
      })
    }
    tiles.push(tile)
    tilesEl.append(tile.el)
    timeline.addTile(tile)
    audio.addTile(tile)
  }
  relayout()
  updateEmpty()
}

function removeTile(tile: VideoTile): void {
  const i = tiles.indexOf(tile)
  if (i < 0) return
  tiles.splice(i, 1)
  endExit(tile, false)
  timeline.removeTile(tile)
  audio.removeTile(tile)
  tile.dispose()
  relayout()
  updateEmpty()
}

// --- collapsing finished videos out of the grid ---

/** Set when any tile's finished state flips; consumed once per frame by step(). */
let layoutDirty = false
/** Tiles currently shrinking away, with the rect they left from and their teardown timer. */
const exiting = new Map<VideoTile, { rect: DOMRect; timer: number }>()
/** True while a tile is laid out in the grid (neither collapsed nor mid-exit). */
function inFlow(tile: VideoTile): boolean {
  return !tile.el.classList.contains('collapsed') && !tile.el.classList.contains('exiting')
}

/**
 * Finished videos leave the grid so the rest can grow — except at the end of the
 * timeline, where every tile comes back so playback ends on a wall of final
 * frames rather than a black stage. "Still running" ignores tiles that can't
 * decode (duration 0, never finish), so one unplayable file can't suppress that.
 */
function collapsing(): boolean {
  return tiles.some((t) => !t.finished && t.duration > 0)
}

function endExit(tile: VideoTile, collapsed: boolean): void {
  const ex = exiting.get(tile)
  if (!ex) return
  clearTimeout(ex.timer)
  exiting.delete(tile)
  tile.el.classList.remove('exiting', 'flip')
  const s = tile.el.style
  s.left = s.top = s.width = s.height = s.transform = s.opacity = ''
  tile.el.classList.toggle('collapsed', collapsed)
}

/** #tiles is centred, so its box shifts whenever the column count changes. */
function pinExit(tile: VideoTile, rect: DOMRect, origin: DOMRect): void {
  const s = tile.el.style
  s.left = `${rect.left - origin.left}px`
  s.top = `${rect.top - origin.top}px`
  s.width = `${rect.width}px`
  s.height = `${rect.height}px`
}

/**
 * Size the grid to the tiles currently on screen, optionally animating the
 * survivors into their new cells (FLIP) while the departing tiles shrink away.
 */
function relayout(animate = false): void {
  if (tiles.length === 0) return

  const collapse = collapsing()
  const hide = (t: VideoTile): boolean => collapse && t.finished
  // Reveals snap. They only happen while scrubbing or at the end of the
  // timeline, and animating one would fight the stream of seeks behind it.
  if (tiles.some((t) => !inFlow(t) && !hide(t))) animate = false

  // getBoundingClientRect reports the *transformed* box, so a tile caught
  // mid-flight re-targets from where it visually is instead of snapping back.
  const first = new Map<VideoTile, DOMRect>()
  if (animate) for (const t of tiles) if (inFlow(t)) first.set(t, t.el.getBoundingClientRect())
  // Clearing transforms is also the safety valve for un-animated relayouts (a
  // window resize mid-flight): nothing is left stranded. Tiles already on their
  // way out keep theirs and finish their own shrink.
  for (const t of tiles) {
    if (exiting.has(t)) continue
    t.el.classList.remove('flip')
    t.el.style.transform = ''
  }

  const leaving: VideoTile[] = []
  for (const t of tiles) {
    if (!hide(t)) {
      endExit(t, false)
      t.el.classList.remove('collapsed')
    } else if (!exiting.has(t)) {
      // .exiting leaves the flow immediately, so the measurement below sees the
      // grid the survivors are actually moving into.
      if (animate && first.has(t)) {
        leaving.push(t)
        t.el.classList.add('exiting')
      } else {
        t.el.classList.add('collapsed')
      }
    }
  }

  const visible = tiles.filter(inFlow)
  const rect = stage.getBoundingClientRect()
  const l = computeLayout(visible.length, rect.width, rect.height, titlesVisible ? STRIP_HEIGHT : 0)
  tilesEl.style.setProperty('--tile-w', `${l.tileW}px`)
  tilesEl.style.setProperty('--tile-h', `${l.tileH}px`)
  tilesEl.style.width = `${l.cols * l.tileW + (l.cols - 1) * TILE_GAP + 1}px`

  const origin = tilesEl.getBoundingClientRect()
  for (const [t, ex] of exiting) pinExit(t, ex.rect, origin)
  if (!animate) return

  for (const t of leaving) {
    const r = first.get(t)!
    exiting.set(t, { rect: r, timer: window.setTimeout(() => endExit(t, true), EXIT_MS) })
    // Explicit size: --tile-w/h have already grown for the smaller grid.
    pinExit(t, r, origin)
  }

  // Invert: put every survivor back where it just was...
  for (const t of visible) {
    const a = first.get(t)
    if (!a) continue
    const b = t.el.getBoundingClientRect()
    if (!b.width || !b.height) continue
    const [dx, dy] = [a.left - b.left, a.top - b.top]
    t.el.style.transform = `translate(${dx}px, ${dy}px) scale(${a.width / b.width}, ${a.height / b.height})`
  }
  void tilesEl.offsetWidth // ...flush that frame, then release it.
  for (const t of visible) {
    if (!first.has(t)) continue
    t.el.classList.add('flip')
    t.el.style.transform = ''
  }
  for (const t of leaving) {
    t.el.classList.add('flip')
    t.el.style.transform = 'scale(0)'
    t.el.style.opacity = '0'
  }
}

function updateEmpty(): void {
  emptyEl.style.display = tiles.length ? 'none' : 'flex'
}

new ResizeObserver(() => relayout()).observe(stage)

// --- ingestion ---

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

async function addPaths(paths: string[]): Promise<void> {
  if (!paths.length) return
  const urls = await window.api!.mediaUrls(paths)
  addSources(paths.map((p, i) => ({ url: urls[i], name: basename(p) })))
}

function addBrowserFiles(files: File[]): void {
  addSources(
    files
      .filter((f) => f.type.startsWith('video/') || /\.(mp4|m4v|webm|ogg|ogv|mov|mkv)$/i.test(f.name))
      .map((f) => ({ url: URL.createObjectURL(f), name: f.name, revoke: true }))
  )
}

btnAdd.addEventListener('click', async () => {
  if (window.api) addPaths(await window.api.openFiles())
  else fileInput.click()
})

fileInput.addEventListener('change', () => {
  addBrowserFiles([...(fileInput.files ?? [])])
  fileInput.value = ''
})

window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', async (e) => {
  e.preventDefault()
  const files = [...(e.dataTransfer?.files ?? [])]
  if (!files.length) return
  if (window.api) {
    const paths = files.map((f) => window.api!.pathForFile(f)).filter(Boolean)
    addPaths(await window.api.expandPaths(paths))
  } else {
    addBrowserFiles(files)
  }
})

window.api?.onAutoload((paths) => addPaths(paths))

// --- transport controls ---

function togglePlay(): void {
  if (timeline.playing) {
    timeline.pause()
  } else {
    if (timeline.atEnd()) timeline.seek(0)
    timeline.play()
  }
}

function cycleRate(step: number): void {
  const i = RATES.indexOf(timeline.rate)
  const next = RATES[Math.min(Math.max(i + step, 0), RATES.length - 1)]
  timeline.setRate(next)
  rateSel.value = String(next)
}

btnPlay.addEventListener('click', togglePlay)
btnBack.addEventListener('click', () => timeline.seekBy(-10))
btnFwd.addEventListener('click', () => timeline.seekBy(10))
rateSel.addEventListener('change', () => timeline.setRate(parseFloat(rateSel.value)))
btnAll.addEventListener('click', () => audio.allSound())
btnMute.addEventListener('click', () => {
  audio.toggleMute()
  btnMute.textContent = audio.muted ? '🔇' : '🔊'
  btnMute.classList.toggle('active', audio.muted)
})

function toggleTitles(): void {
  titlesVisible = !titlesVisible
  tilesEl.classList.toggle('no-strips', !titlesVisible)
  btnTitles.classList.toggle('active', titlesVisible)
  relayout()
}

btnTitles.addEventListener('click', toggleTitles)

// --- full screen ---
// Native full screen (Electron) drops the window frame and covers the taskbar;
// the .fullscreen class takes care of our own toolbar. F11 is NOT bound here in
// the Electron path: the default menu's Toggle Full Screen accelerator already
// owns that key, and toggling on both would cancel itself out.

/** Distance from the bottom edge that re-reveals the toolbar in full screen. */
const REVEAL_ZONE = 72
let fullscreen = false

function applyFullScreen(on: boolean): void {
  fullscreen = on
  document.body.classList.toggle('fullscreen', on)
  if (!on) document.body.classList.remove('show-controls')
  btnFull.classList.toggle('active', on)
  btnFull.title = on ? 'Exit full screen (F11 / Esc)' : 'Full screen (F11)'
}

function toggleFullScreen(): void {
  if (window.api) window.api.toggleFullScreen()
  else if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen()
}

function exitFullScreen(): void {
  if (window.api) window.api.setFullScreen(false)
  else if (document.fullscreenElement) document.exitFullscreen()
}

btnFull.addEventListener('click', toggleFullScreen)
window.api?.onFullScreen(applyFullScreen)
// Browser fallback: no main process to report the state back.
document.addEventListener('fullscreenchange', () => {
  if (!window.api) applyFullScreen(!!document.fullscreenElement)
})

window.addEventListener('mousemove', (e) => {
  if (!fullscreen || scrubbing) return
  document.body.classList.toggle('show-controls', e.clientY >= window.innerHeight - REVEAL_ZONE)
})

// --- slider scrubbing (pause during drag, resume on release) ---

let scrubbing = false
let wasPlaying = false

slider.addEventListener('pointerdown', () => {
  scrubbing = true
  wasPlaying = timeline.playing
  timeline.pause()
})
slider.addEventListener('input', () => timeline.seek(parseFloat(slider.value)))
window.addEventListener('pointerup', () => {
  if (!scrubbing) return
  scrubbing = false
  if (wasPlaying && !timeline.atEnd()) timeline.play()
})

// --- keyboard shortcuts ---

window.addEventListener('keydown', (e) => {
  switch (e.key) {
    case ' ':
      togglePlay()
      break
    case 'ArrowLeft':
      timeline.seekBy(-10)
      break
    case 'ArrowRight':
      timeline.seekBy(10)
      break
    case 'ArrowUp':
      cycleRate(1)
      break
    case 'ArrowDown':
      cycleRate(-1)
      break
    case 'm':
    case 'M':
      btnMute.click()
      return
    case 'a':
    case 'A':
      audio.allSound()
      return
    case 't':
    case 'T':
      toggleTitles()
      return
    case 'F11':
      // Electron's menu accelerator already owns F11; only the browser path needs us.
      if (window.api) return
      toggleFullScreen()
      break
    case 'Escape':
      if (!fullscreen) return
      exitFullScreen()
      break
    default:
      return
  }
  e.preventDefault()
})

// --- per-frame UI sync ---

function fmt(s: number): string {
  s = Math.max(0, Math.floor(s))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

function step(now: number): void {
  timeline.tick(now)
  // One pass for however many tiles just finished, and the single point every
  // finished-state change funnels through — seek() from the slider, the arrow
  // keys and the ±10s buttons all land here on the next frame. Minimized, the
  // 250 ms interval still runs us but transitions may not advance, so snap.
  if (layoutDirty) {
    layoutDirty = false
    relayout(!scrubbing && !document.hidden)
  }
  const dur = timeline.duration
  if (!scrubbing) {
    slider.max = String(dur)
    slider.value = String(timeline.currentTime)
  }
  const durStamp = fmt(dur)
  timeEl.textContent = `${fmt(timeline.currentTime)} / ${durStamp}`
  // Elapsed never prints wider than the duration, so a stamp pair built from the
  // duration is the widest the readout can get; measure that once per format
  // change and reserve exactly it.
  if (durStamp.length !== timeReserve) {
    timeReserve = durStamp.length
    timeProbe.textContent = `${durStamp} / ${durStamp}`
    timeEl.style.setProperty('--time-w', `${timeProbe.getBoundingClientRect().width}px`)
  }
  // A drag pauses the timeline underneath, but that is plumbing, not a transport
  // change: keep showing the state the release will restore so the button only
  // ever flips when play/pause is actually used.
  btnPlay.classList.toggle('playing', scrubbing ? wasPlaying : timeline.playing)
  btnAll.classList.toggle('active', audio.isAllSound && !audio.muted)
  btnAll.classList.toggle('active-dim', audio.isAllSound && audio.muted)
}

function frame(now: number): void {
  step(now)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
// rAF pauses while the window is minimized/hidden; keep timeline logic
// (drift correction, finished states, end-of-timeline stop) alive regardless.
setInterval(() => step(performance.now()), 250)
updateEmpty()

// Debug/testing hook
;(window as unknown as Record<string, unknown>).mm = { addSources, removeTile, timeline, audio, tiles, toggleTitles, toggleFullScreen }
