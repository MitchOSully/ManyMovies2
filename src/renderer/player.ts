export interface VideoSource {
  url: string
  name: string
  /** true when url is a blob: URL that must be revoked on dispose */
  revoke?: boolean
}

export class VideoTile {
  readonly el: HTMLElement
  readonly video: HTMLVideoElement
  readonly name: string
  finished = false
  private readonly revokeUrl: string | null

  onClickVideo: ((tile: VideoTile, ctrl: boolean) => void) | null = null
  onClose: ((tile: VideoTile) => void) | null = null

  constructor(source: VideoSource) {
    this.name = source.name
    this.revokeUrl = source.revoke ? source.url : null

    this.el = document.createElement('div')
    this.el.className = 'tile'

    const strip = document.createElement('div')
    strip.className = 'strip'
    const label = document.createElement('span')
    label.className = 'strip-name'
    label.textContent = source.name
    label.title = source.name
    const close = document.createElement('button')
    close.className = 'strip-close'
    close.textContent = '✕'
    close.title = 'Remove video'
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      this.onClose?.(this)
    })
    strip.append(label, close)

    const frame = document.createElement('div')
    frame.className = 'frame'
    this.video = document.createElement('video')
    this.video.src = source.url
    this.video.preload = 'auto'
    this.video.disablePictureInPicture = true
    const overlay = document.createElement('div')
    overlay.className = 'finished-overlay'
    const overlayText = document.createElement('span')
    overlayText.textContent = '[FINISHED]'
    overlay.append(overlayText)

    const errorOverlay = document.createElement('div')
    errorOverlay.className = 'error-overlay'
    const errorTitle = document.createElement('span')
    errorTitle.textContent = "[CAN'T PLAY]"
    const errorDetail = document.createElement('small')
    errorOverlay.append(errorTitle, errorDetail)
    this.video.addEventListener('error', () => {
      const code = this.video.error?.code
      errorDetail.textContent =
        { 1: 'loading aborted', 2: 'network error', 3: 'decoding failed', 4: 'format or source not supported' }[
          code ?? 0
        ] ?? 'unknown error'
      this.el.classList.add('load-error')
    })

    frame.append(this.video, overlay, errorOverlay)
    frame.addEventListener('click', (e) => {
      this.onClickVideo?.(this, e.ctrlKey || e.metaKey)
    })

    this.el.append(strip, frame)
  }

  /** 0 until metadata has loaded */
  get duration(): number {
    const d = this.video.duration
    return Number.isFinite(d) ? d : 0
  }

  setFinished(finished: boolean): void {
    if (this.finished === finished) return
    this.finished = finished
    this.el.classList.toggle('finished', finished)
    if (finished) this.video.pause()
  }

  dispose(): void {
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load()
    if (this.revokeUrl) URL.revokeObjectURL(this.revokeUrl)
    this.el.remove()
  }
}
