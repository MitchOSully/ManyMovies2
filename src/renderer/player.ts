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
  /** Fired only when `finished` actually flips; the grid collapses around it. */
  onFinishedChange: ((tile: VideoTile) => void) | null = null

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

    // Chromium silently drops audio tracks it can't decode (AC-3, E-AC-3, DTS…)
    // and plays the video alone, so a file with no audio track and one with an
    // unplayable track look the same. Judge by the decoder counter once the
    // tile has actually played a moment; muted tiles still decode audio.
    const noAudioBadge = document.createElement('div')
    noAudioBadge.className = 'no-audio-badge'
    noAudioBadge.textContent = 'NO AUDIO'
    noAudioBadge.title = 'No playable audio track (Chromium cannot decode AC-3, E-AC-3 or DTS audio)'
    const checkAudio = (): void => {
      const decoded = (this.video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number })
        .webkitAudioDecodedByteCount
      if (decoded === undefined || decoded > 0) {
        this.video.removeEventListener('timeupdate', checkAudio)
        return
      }
      const played = this.video.played
      let seconds = 0
      for (let i = 0; i < played.length; i++) seconds += played.end(i) - played.start(i)
      if (seconds < 1.5) return
      this.el.classList.add('no-audio')
      this.video.removeEventListener('timeupdate', checkAudio)
    }
    this.video.addEventListener('timeupdate', checkAudio)

    // Duplicate remove control for when the title strip (and its ✕) is hidden;
    // CSS reveals it on hover in that mode only.
    const frameClose = document.createElement('button')
    frameClose.className = 'frame-close'
    frameClose.textContent = '✕'
    frameClose.title = 'Remove video'
    frameClose.addEventListener('click', (e) => {
      e.stopPropagation()
      this.onClose?.(this)
    })
    // Hover-revealed filename bar, standing in for the hidden strip.
    const frameTitle = document.createElement('div')
    frameTitle.className = 'frame-title'
    frameTitle.textContent = source.name

    frame.append(this.video, noAudioBadge, errorOverlay, frameTitle, frameClose)
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
    this.onFinishedChange?.(this)
  }

  dispose(): void {
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load()
    if (this.revokeUrl) URL.revokeObjectURL(this.revokeUrl)
    this.el.remove()
  }
}
