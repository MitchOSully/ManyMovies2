import type { VideoTile } from './player'

const EPS = 0.08
const DRIFT_CHECK_MS = 250
// Drift is corrected two ways. Small offsets are steered out by running the
// tile slightly fast or slow: invisible, and pitch-preserved so the audible
// tile doesn't warble. Only a big offset is worth a seek, which freezes the
// tile while the decoder re-decodes from the previous keyframe (up to ~10 s of
// frames on long-GOP encodes) — and since the group keeps moving meanwhile,
// the seek aims ahead by that tile's measured seek latency.
/** Offsets beyond this (s) are re-seeked; anything smaller is steered by rate. */
const SNAP_THRESHOLD = 0.5
/** Steering starts beyond NUDGE_START (s) and continues until back within NUDGE_STOP. */
const NUDGE_START = 0.06
const NUDGE_STOP = 0.02
/** Largest steering rate change, as a fraction of the user's rate; reached at NUDGE_FULL_AT (s). */
const MAX_NUDGE = 0.05
const NUDGE_FULL_AT = 0.25
/** Assumed time (s) for a seek to resume playback until a tile has been measured. */
const DEFAULT_SEEK_LATENCY = 0.1
/** Cap on one latency sample (s): a seek that ran into a stall says nothing about the next. */
const MAX_SEEK_LATENCY = 2
// HAVE_FUTURE_DATA: a tile below this is buffering and can't be trusted as a
// clock, nor helped by being seeked (a seek just aborts its recovery).
const HEALTHY_READY_STATE = 3
// A tile whose position is further than this from the group is re-joining
// after a stall; it must be drift-snapped forward before it can be trusted
// as the reference clock again (otherwise it would drag the wall backward).
const CLOCK_TRUST_WINDOW = 1.0

interface SyncState {
  /** Current steering, as a fraction of the user's rate (0 = none). */
  nudge: number
  /** performance.now() of a drift seek still in progress, else null. */
  snapAt: number | null
  /** Smoothed seconds a drift seek takes to resume playback. */
  seekLatency: number
}

/**
 * Global timeline: all videos aligned at t=0, spanning 0 -> longest duration.
 * The reference clock is the longest video that is actually advancing —
 * healthy (not buffering) and near the last known global time. Other tiles
 * are drift-corrected against it a few times a second while playing; a
 * stalled tile freezes alone and gets snapped forward once it recovers.
 */
export class Timeline {
  private tiles: VideoTile[] = []
  private sync = new Map<VideoTile, SyncState>()
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
    this.sync.set(tile, { nudge: 0, snapAt: null, seekLatency: DEFAULT_SEEK_LATENCY })
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
    this.sync.delete(tile)
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
    for (const tile of this.tiles) {
      tile.video.pause()
      this.steer(tile, 0)
    }
  }

  seek(time: number): void {
    const t = Math.min(Math.max(time, 0), this.duration)
    this.lastTime = t
    for (const tile of this.tiles) {
      this.steer(tile, 0)
      this.sync.get(tile)!.snapAt = null
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
    for (const tile of this.tiles) {
      this.sync.get(tile)!.nudge = 0
      tile.video.playbackRate = rate
    }
  }

  /**
   * Run `tile` fast (it's behind) or slow (it's ahead) in proportion to `gap`
   * (tile minus group, s), with hysteresis so it isn't forever fiddling.
   * A gap of 0 restores the user's rate.
   */
  private steer(tile: VideoTile, gap: number): void {
    const s = this.sync.get(tile)!
    const mag = Math.abs(gap)
    let nudge = 0
    if (mag >= NUDGE_STOP && (mag > NUDGE_START || s.nudge !== 0)) {
      // Whole-percent steps: playbackRate is only rewritten when the step changes.
      const pct = Math.max(2, Math.round((100 * MAX_NUDGE * Math.min(mag, NUDGE_FULL_AT)) / NUDGE_FULL_AT))
      nudge = (-Math.sign(gap) * pct) / 100
    }
    if (nudge === s.nudge) return
    s.nudge = nudge
    tile.video.playbackRate = this.rate * (1 + nudge)
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

    // Time each drift seek to playback, per frame so the estimate is tight.
    for (const tile of this.tiles) {
      const s = this.sync.get(tile)!
      if (s.snapAt === null || tile.video.seeking || tile.video.readyState < HEALTHY_READY_STATE) continue
      const took = Math.min((now - s.snapAt) / 1000, MAX_SEEK_LATENCY)
      s.seekLatency = (s.seekLatency + took) / 2
      s.snapAt = null
    }

    if (now - this.lastDriftCheck > DRIFT_CHECK_MS) {
      this.lastDriftCheck = now
      const ref = this.reference()
      for (const tile of this.tiles) {
        if (tile.finished || tile.duration === 0) continue
        const v = tile.video
        if (tile === ref || v.seeking || v.readyState < HEALTHY_READY_STATE) {
          this.steer(tile, 0)
        } else {
          const gap = v.currentTime - t
          if (Math.abs(gap) > SNAP_THRESHOLD) {
            const s = this.sync.get(tile)!
            this.steer(tile, 0)
            // Not past the end: landing there early would finish the tile early.
            v.currentTime = Math.min(t + s.seekLatency * this.rate, tile.duration - EPS)
            s.snapAt = now
          } else {
            this.steer(tile, gap)
          }
        }
        if (tile !== ref && v.paused) void v.play().catch(() => {})
      }
    }
  }
}
