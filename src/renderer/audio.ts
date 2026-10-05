import type { VideoTile } from './player'

/**
 * Audio model: all tiles audible by default. Plain click solos one tile, or
 * turns an already-audible tile back off when only some tiles are audible;
 * Ctrl+click toggles a tile in/out of the audible set; "All sound" restores
 * everyone. An empty audible set always falls back to all sound. Global mute
 * is a layer on top that preserves the audible set.
 */
export class AudioController {
  private readonly tiles: VideoTile[] = []
  private audible = new Set<VideoTile>()
  /** true = "everyone audible" mode; new tiles auto-join the set */
  private allMode = true
  muted = false

  addTile(tile: VideoTile): void {
    this.tiles.push(tile)
    if (this.allMode) this.audible.add(tile)
    this.apply()
  }

  removeTile(tile: VideoTile): void {
    const i = this.tiles.indexOf(tile)
    if (i >= 0) this.tiles.splice(i, 1)
    this.audible.delete(tile)
    this.apply()
  }

  /** Plain click: solo, or turn off a tile that's audible in a strict subset. */
  click(tile: VideoTile): void {
    if (this.isAllSound || !this.audible.has(tile)) this.solo(tile)
    else this.toggleInSet(tile)
  }

  solo(tile: VideoTile): void {
    this.allMode = false
    this.audible = new Set([tile])
    this.apply()
  }

  toggleInSet(tile: VideoTile): void {
    this.allMode = false
    if (this.audible.has(tile)) this.audible.delete(tile)
    else this.audible.add(tile)
    this.apply()
  }

  allSound(): void {
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
    for (const tile of this.tiles) {
      const audible = this.audible.has(tile)
      tile.video.muted = !audible || this.muted
      tile.video.volume = 1
      tile.el.classList.toggle('audible', audible && !all)
      tile.el.classList.toggle('muted-global', this.muted)
    }
  }
}
