import type { VideoTile } from './player'

/**
 * Audio model: all tiles audible by default. Plain click solos one tile,
 * Ctrl+click toggles a tile in/out of the audible set, "All sound" restores
 * everyone. Global mute is a layer on top that preserves the audible set.
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
    if (this.audible.size === 0) this.allSound()
    else this.apply()
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

  private apply(): void {
    for (const tile of this.tiles) {
      const audible = this.audible.has(tile)
      tile.video.muted = !audible || this.muted
      tile.video.volume = 1
      tile.el.classList.toggle('audible', audible)
      tile.el.classList.toggle('muted-global', this.muted)
    }
  }
}
