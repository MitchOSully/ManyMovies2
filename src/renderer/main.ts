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
const slider = $<HTMLInputElement>('slider')
const timeEl = $<HTMLSpanElement>('time')
const fileInput = $<HTMLInputElement>('file-input')

const RATES = [0.5, 1, 2]
const tiles: VideoTile[] = []
const timeline = new Timeline()
const audio = new AudioController()
/** Title strips above each video; hiding them gives the grid their height back. */
let titlesVisible = false

// --- tile management ---

function addSources(sources: VideoSource[]): void {
  for (const s of sources) {
    const tile = new VideoTile(s)
    tile.onClickVideo = (t, ctrl) => (ctrl ? audio.toggleInSet(t) : audio.solo(t))
    tile.onClose = removeTile
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
  timeline.removeTile(tile)
  audio.removeTile(tile)
  tile.dispose()
  relayout()
  updateEmpty()
}

function relayout(): void {
  if (tiles.length === 0) return
  const rect = stage.getBoundingClientRect()
  const l = computeLayout(tiles.length, rect.width, rect.height, titlesVisible ? STRIP_HEIGHT : 0)
  tilesEl.style.setProperty('--tile-w', `${l.tileW}px`)
  tilesEl.style.setProperty('--tile-h', `${l.tileH}px`)
  tilesEl.style.width = `${l.cols * l.tileW + (l.cols - 1) * TILE_GAP + 1}px`
}

function updateEmpty(): void {
  emptyEl.style.display = tiles.length ? 'none' : 'flex'
}

new ResizeObserver(relayout).observe(stage)

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
      .filter((f) => f.type.startsWith('video/') || /\.(mp4|m4v|webm|ogg|ogv|mov)$/i.test(f.name))
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
  const dur = timeline.duration
  if (!scrubbing) {
    slider.max = String(dur)
    slider.value = String(timeline.currentTime)
  }
  timeEl.textContent = `${fmt(timeline.currentTime)} / ${fmt(dur)}`
  btnPlay.textContent = timeline.playing ? '⏸' : '▶'
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
;(window as unknown as Record<string, unknown>).mm = { addSources, removeTile, timeline, audio, tiles, toggleTitles }
