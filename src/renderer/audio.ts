import type { VideoTile } from './player'

export interface AudioSnapshot {
  audible: Set<VideoTile>
  allMode: boolean
}

/**
 * Audio model: all tiles audible by default. Plain click solos one tile, or
 * turns an already-audible tile back off when only some tiles are audible;
 * Ctrl+click toggles a tile in/out of the audible set; "All sound" restores
 * everyone. An empty audible set always falls back to all sound. Global mute
 * is a layer on top that preserves the audible set. While cycling, every
 * click (Ctrl or not) solos, and "All sound" ends the cycle.
 */
export class AudioController {
  private readonly tiles: VideoTile[] = []
  private audible = new Set<VideoTile>()
  /** true = "everyone audible" mode; new tiles auto-join the set */
  private allMode = true
  muted = false
  /** Cycle mode (see cycle.ts): one audible tile at a time, so every click solos. */
  cycling = false
  /** A click picked this tile while cycling; its turn starts over. */
  onPick: ((tile: VideoTile) => void) | null = null
  /** "All sound" ended cycle mode. */
  onCycleEnd: (() => void) | null = null
  /**
   * The large video (see setLarge in main.ts). It is obviously the one being
   * listened to when it's the only audible tile, so it skips the border then.
   */
  private featured: VideoTile | null = null

  addTile(tile: VideoTile): void {
    this.tiles.push(tile)
    if (this.allMode) this.audible.add(tile)
    this.apply()
  }

  removeTile(tile: VideoTile): void {
    const i = this.tiles.indexOf(tile)
    if (i >= 0) this.tiles.splice(i, 1)
    this.audible.delete(tile)
    if (this.featured === tile) this.featured = null
    this.apply()
  }

  setFeatured(tile: VideoTile | null): void {
    this.featured = tile
    this.apply()
  }

  /** A tile was made large: its audio takes over (a pick, while cycling). */
  feature(tile: VideoTile): void {
    if (this.cycling) this.pick(tile)
    else this.solo(tile)
  }

  /** The audible set, to undo the clicks a double-click is made of. */
  snapshot(): AudioSnapshot {
    return { audible: new Set(this.audible), allMode: this.allMode }
  }

  restore(s: AudioSnapshot): void {
    this.audible = new Set([...s.audible].filter((t) => this.tiles.includes(t)))
    this.allMode = s.allMode
    this.apply()
  }

  /** Plain click: solo, or turn off a tile that's audible in a strict subset. */
  click(tile: VideoTile): void {
    if (this.cycling) this.pick(tile)
    else if (this.isAllSound || !this.audible.has(tile)) this.solo(tile)
    else this.toggleInSet(tile)
  }

  private pick(tile: VideoTile): void {
    this.solo(tile)
    this.onPick?.(tile)
  }

  solo(tile: VideoTile): void {
    this.allMode = false
    this.audible = new Set([tile])
    this.apply()
  }

  toggleInSet(tile: VideoTile): void {
    if (this.cycling) return this.pick(tile)
    this.allMode = false
    if (this.audible.has(tile)) this.audible.delete(tile)
    else this.audible.add(tile)
    this.apply()
  }

  allSound(): void {
    if (this.cycling) {
      this.cycling = false
      this.onCycleEnd?.()
    }
    this.allMode = true
    this.audible = new Set(this.tiles)
    this.apply()
  }

  toggleMute(): void {
    this.muted = !this.muted
    this.apply()
  }

  isAudible(tile: VideoTile): boolean {
    return this.audible.has(tile)
  }

  /** The soloed tiles in grid order; empty when everyone is audible. */
  get soloed(): VideoTile[] {
    return this.isAllSound ? [] : this.tiles.filter((t) => this.audible.has(t))
  }

  /** True when every tile is audible — the default, borderless state. */
  get isAllSound(): boolean {
    return this.tiles.length > 0 && this.audible.size === this.tiles.length
  }

  private apply(): void {
    // Nobody audible is never a state worth keeping (mute covers silence):
    // turning off the last audible tile brings everyone back.
    if (this.audible.size === 0) this.audible = new Set(this.tiles)
    // All-sound is judged by the actual set, not how it was reached: a full
    // set hand-assembled via Ctrl+clicks re-enables all-mode, so later
    // additions join the audible set and no borders show.
    const all = this.isAllSound
    if (all) this.allMode = true
    const soleFeatured = this.audible.size === 1 && this.featured !== null && this.audible.has(this.featured)
    for (const tile of this.tiles) {
      const audible = this.audible.has(tile)
      tile.video.muted = !audible || this.muted
      tile.video.volume = 1
      tile.el.classList.toggle('audible', audible && !all && !soleFeatured)
      tile.el.classList.toggle('muted-global', this.muted)
    }
  }
}
