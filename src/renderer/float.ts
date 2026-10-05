import type { VideoTile } from './player'

/** Grid-tile classes the float window mirrors: audio state and the overlays. */
const MIRRORED = ['audible', 'muted-global', 'no-audio', 'load-error', 'finished']
/** Default float size, before the main process applies remembered bounds. */
const DEFAULT_W = 960
const MAX_DEFAULT_H = 720

interface Float {
  win: Window
  name: string
  observer: MutationObserver
}

/**
 * Floats a tile into its own window: a same-origin `window.open` child, which
 * shares this renderer, so the tile's own `.frame` (and its `<video>`) is moved
 * in rather than cloned. Timeline and audio keep driving the very same element.
 * Chromium reloads a media element when it changes document, so every move in
 * or out is reported through `onMove` for the timeline to re-join it.
 */
export class FloatController {
  private readonly floats = new Map<VideoTile, Float>()
  private seq = 0
  /** The tile's video just changed window and is reloading. */
  onMove: ((tile: VideoTile) => void) | null = null
  /** Keys pressed in a float window that the float doesn't handle itself. */
  onKey: ((e: KeyboardEvent) => void) | null = null

  constructor() {
    // Floats can't outlive the window that drives them (reload, close).
    window.addEventListener('pagehide', () => {
      for (const tile of [...this.floats.keys()]) this.release(tile)
    })
  }

  isFloated(tile: VideoTile): boolean {
    return this.floats.has(tile)
  }

  float(tile: VideoTile): void {
    const existing = this.floats.get(tile)
    if (existing) {
      existing.win.focus()
      return
    }
    const name = `mm-float-${++this.seq}`
    const v = tile.video
    const aspect = v.videoWidth && v.videoHeight ? v.videoHeight / v.videoWidth : 9 / 16
    let w = DEFAULT_W
    let h = Math.round(w * aspect)
    if (h > MAX_DEFAULT_H) {
      h = MAX_DEFAULT_H
      w = Math.round(h / aspect)
    }
    const win = window.open('about:blank', name, `popup,width=${w},height=${h}`)
    if (!win) return

    const doc = win.document
    doc.title = tile.name
    for (const node of document.querySelectorAll<HTMLElement>('link[rel="stylesheet"], style')) {
      const copy = doc.importNode(node, true)
      // about:blank has no base URL of its own to resolve a relative href against.
      if (node.tagName === 'LINK') copy.setAttribute('href', (node as HTMLLinkElement).href)
      doc.head.append(copy)
    }
    doc.body.className = 'float'
    const host = doc.createElement('div')
    doc.body.append(host)
    host.append(tile.frame)
    tile.el.classList.add('floated')

    const mirror = (): void => {
      host.className = ['tile', 'float-host', ...MIRRORED.filter((c) => tile.el.classList.contains(c))].join(' ')
    }
    mirror()
    const observer = new MutationObserver(mirror)
    observer.observe(tile.el, { attributes: true, attributeFilter: ['class'] })

    win.addEventListener('keydown', (e) => {
      if (e.key === 'F11') {
        // Electron's menu accelerator already full-screens the focused window.
        if (window.api) return
        if (doc.fullscreenElement) void doc.exitFullscreen()
        else void doc.documentElement.requestFullscreen()
      } else if (e.key === 'Escape') {
        if (window.api) void window.api.setFloatFullScreen(name, false)
        else if (doc.fullscreenElement) void doc.exitFullscreen()
      } else {
        this.onKey?.(e)
        return
      }
      e.preventDefault()
    })
    // Closing the window docks the tile back into the grid.
    win.addEventListener('pagehide', () => this.dock(tile))

    this.floats.set(tile, { win, name, observer })
    this.onMove?.(tile)
  }

  /** Bring a floated tile's video back into its grid tile and close the window. */
  dock(tile: VideoTile): void {
    if (!this.release(tile)) return
    tile.el.append(tile.frame)
    tile.el.classList.remove('floated')
    this.onMove?.(tile)
  }

  /** Close a tile's float without docking (the tile is being removed). */
  release(tile: VideoTile): boolean {
    const f = this.floats.get(tile)
    if (!f) return false
    this.floats.delete(tile)
    f.observer.disconnect()
    if (!f.win.closed) f.win.close()
    return true
  }

  /** Safety net for a float window that went away without a pagehide. */
  check(): void {
    for (const [tile, f] of this.floats) if (f.win.closed) this.dock(tile)
  }

  /** Window name of a tile's float, for tests. */
  nameOf(tile: VideoTile): string | null {
    return this.floats.get(tile)?.name ?? null
  }
}
