import type { VideoTile } from './player'
import type { AudioController } from './audio'
import type { Timeline } from './timeline'

/** A tile worth a turn: still playing and decodable (finished/broken ones would be silence). */
function eligible(t: VideoTile): boolean {
  return !t.finished && t.duration > 0 && !t.el.classList.contains('load-error')
}

/**
 * Audio cycle mode: one tile audible at a time, handing over to the next in
 * grid order every `interval` seconds of *timeline* time — pausing freezes the
 * turn, 2× halves it, and seeks don't count towards it. A click picks a tile
 * (fresh turn, the rotation carries on from it); a tile that finishes, fails
 * or is removed mid-turn hands over at once. The current tile carries
 * `.cycling` and `--cycle-progress` (0..1) for the bar in its title strip.
 */
export class CycleController {
  active = false
  interval = 10
  private current: VideoTile | null = null
  /** Grid index of `current` at the last check; where to resume if it's removed. */
  private index = -1
  private elapsed = 0
  private lastTime = 0
  private lastSeeks = 0

  constructor(
    private readonly audio: AudioController,
    private readonly timeline: Timeline
  ) {
    audio.onPick = (t) => this.setCurrent(t)
    audio.onCycleEnd = () => this.stop()
  }

  /** Starts with the first soloed tile, else the first one that can play. */
  start(tiles: VideoTile[]): void {
    this.active = true
    this.audio.cycling = true
    this.lastTime = this.timeline.currentTime
    this.lastSeeks = this.timeline.seeks
    const first = this.audio.soloed.find(eligible) ?? tiles.find(eligible) ?? null
    if (first) this.audio.solo(first)
    this.setCurrent(first)
  }

  /** Whoever has the turn stays soloed. */
  stop(): void {
    this.active = false
    this.audio.cycling = false
    this.setCurrent(null)
  }

  setInterval(seconds: number): void {
    this.interval = seconds
  }

  /** Called every frame: counts down the turn and hands over when it's up. */
  tick(tiles: VideoTile[]): void {
    if (!this.active) return
    const t = this.timeline.currentTime
    const delta = t - this.lastTime
    // Only plain forward playback counts; any jump (a seek, or a reference
    // clock hop bigger than a minimized interval at 2×) is ignored.
    if (this.timeline.playing && this.timeline.seeks === this.lastSeeks && delta > 0 && delta <= 2) {
      this.elapsed += delta
    }
    this.lastTime = t
    this.lastSeeks = this.timeline.seeks
    this.refresh(tiles)
    this.current?.el.style.setProperty('--cycle-progress', String(Math.min(this.elapsed / this.interval, 1)))
  }

  /**
   * Hands over if the turn is up or the current tile can no longer play. Also
   * called straight from removal, so a removed tile's turn passes on before
   * its audio goes (an empty audible set would fall back to all sound).
   */
  refresh(tiles: VideoTile[]): void {
    if (!this.active) return
    let i = this.index
    if (this.current && tiles.includes(this.current)) {
      i = tiles.indexOf(this.current)
      if (eligible(this.current) && this.elapsed < this.interval) {
        this.index = i
        return
      }
    } else if (this.current) {
      // Removed: the tile after it now sits at its old index.
      i--
      this.setCurrent(null)
    }
    this.index = i
    for (let k = 1; k <= tiles.length; k++) {
      const next = tiles[(((i + k) % tiles.length) + tiles.length) % tiles.length]
      if (!eligible(next)) continue
      this.audio.solo(next)
      this.setCurrent(next)
      this.index = tiles.indexOf(next)
      return
    }
    // Nobody can play: idle (on the current tile, if any) until someone can again.
    this.elapsed = 0
  }

  private setCurrent(tile: VideoTile | null): void {
    if (this.current !== tile) this.current?.el.classList.remove('cycling')
    this.current = tile
    this.elapsed = 0
    if (!tile) return
    tile.el.classList.add('cycling')
    tile.el.style.setProperty('--cycle-progress', '0')
  }
}
