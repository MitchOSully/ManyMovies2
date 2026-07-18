import type { VideoTile } from './player'

const EPS = 0.08
const DRIFT_TOLERANCE = 0.35
const DRIFT_CHECK_MS = 1000
// HAVE_FUTURE_DATA: a tile below this is buffering and can't be trusted as a
// clock, nor helped by being seeked (a seek just aborts its recovery).
const HEALTHY_READY_STATE = 3
// A tile whose position is further than this from the group is re-joining
// after a stall; it must be drift-snapped forward before it can be trusted
// as the reference clock again (otherwise it would drag the wall backward).
const CLOCK_TRUST_WINDOW = 1.0

/**
 * Global timeline: all videos aligned at t=0, spanning 0 -> longest duration.
 * The reference clock is the longest video that is actually advancing —
 * healthy (not buffering) and near the last known global time. Other tiles
 * are drift-corrected against it about once a second while playing; a
 * stalled tile freezes alone and gets snapped forward once it recovers.
 */
export class Timeline {
  private tiles: VideoTile[] = []
  playing = false
  rate = 1
  private lastTime = 0
  private lastDriftCheck = 0

  get duration(): number {
    let d = 0
    for (const t of this.tiles) d = Math.max(d, t.duration)
    return d
  }

  private reference(): VideoTile | null {
    let best: VideoTile | null = null
    for (const t of this.tiles) {
      if (t.duration === 0 || t.finished) continue
      if (t.video.readyState < HEALTHY_READY_STATE) continue
      if (Math.abs(t.video.currentTime - this.lastTime) > CLOCK_TRUST_WINDOW) continue
      if (!best || t.duration > best.duration) best = t
    }
    return best
  }

  get currentTime(): number {
    const ref = this.reference()
    return ref ? ref.video.currentTime : this.lastTime
  }

  atEnd(): boolean {
    const d = this.duration
    return d > 0 && this.currentTime >= d - EPS
  }

  addTile(tile: VideoTile): void {
    this.tiles.push(tile)
    tile.video.playbackRate = this.rate
    // A tile added mid-session joins at the current global time (lastTime is
    // captured each tick so the new tile can't be mistaken for the master yet).
    const joinAt = this.lastTime
    const sync = (): void => {
      if (joinAt >= tile.duration - EPS && joinAt > 0) {
        tile.video.currentTime = tile.duration
        tile.setFinished(true)
      } else {
        tile.video.currentTime = joinAt
        if (this.playing) void tile.video.play().catch(() => {})
      }
    }
    if (tile.duration > 0) sync()
    else tile.video.addEventListener('loadedmetadata', sync, { once: true })
  }

  removeTile(tile: VideoTile): void {
    const i = this.tiles.indexOf(tile)
    if (i >= 0) this.tiles.splice(i, 1)
    if (this.tiles.length === 0) {
      this.playing = false
      this.lastTime = 0
    }
  }

  play(): void {
    if (this.duration === 0) return
    this.playing = true
    for (const tile of this.tiles) {
      if (!tile.finished) void tile.video.play().catch(() => {})
    }
  }

  pause(): void {
    this.playing = false
    for (const tile of this.tiles) tile.video.pause()
  }

  seek(time: number): void {
    const t = Math.min(Math.max(time, 0), this.duration)
    this.lastTime = t
    for (const tile of this.tiles) {
      if (tile.duration === 0) continue
      if (t >= tile.duration - EPS) {
        tile.video.currentTime = tile.duration
        tile.setFinished(true)
      } else {
        tile.setFinished(false)
        tile.video.currentTime = t
        if (this.playing && tile.video.paused) void tile.video.play().catch(() => {})
      }
    }
  }

  seekBy(delta: number): void {
    this.seek(this.currentTime + delta)
  }

  setRate(rate: number): void {
    this.rate = rate
    for (const tile of this.tiles) tile.video.playbackRate = rate
  }

  /** Called every animation frame: finished-state upkeep, drift correction, end-of-timeline stop. */
  tick(now: number): void {
    const dur = this.duration
    if (dur === 0) {
      this.lastTime = 0
      return
    }
    const t = this.currentTime
    this.lastTime = t

    for (const tile of this.tiles) {
      if (tile.duration === 0) continue
      const shouldFinish = t >= tile.duration - EPS || tile.video.ended
      if (shouldFinish && !tile.finished) {
        tile.setFinished(true)
      } else if (!shouldFinish && tile.finished) {
        tile.setFinished(false)
        tile.video.currentTime = t
        if (this.playing) void tile.video.play().catch(() => {})
      }
    }

    if (!this.playing) return

    if (t >= dur - EPS) {
      this.pause()
      return
    }

    if (now - this.lastDriftCheck > DRIFT_CHECK_MS) {
      this.lastDriftCheck = now
      const ref = this.reference()
      for (const tile of this.tiles) {
        if (tile === ref || tile.finished || tile.duration === 0) continue
        if (
          tile.video.readyState >= HEALTHY_READY_STATE &&
          Math.abs(tile.video.currentTime - t) > DRIFT_TOLERANCE
        ) {
          tile.video.currentTime = t
        }
        if (tile.video.paused) void tile.video.play().catch(() => {})
      }
    }
  }
}
