import { beforeEach, describe, expect, it } from 'vitest'
import { AudioController } from '../../src/renderer/audio'
import type { VideoTile } from '../../src/renderer/player'

/** Just the surface AudioController touches: video.muted/volume and el.classList. */
function fakeTile(name: string): VideoTile & { classes: Set<string> } {
  const classes = new Set<string>()
  return {
    name,
    classes,
    video: { muted: false, volume: 0.3 },
    el: {
      classList: {
        toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c), on),
        contains: (c: string) => classes.has(c)
      }
    }
  } as unknown as VideoTile & { classes: Set<string> }
}

const audibleNames = (tiles: VideoTile[]): string[] => tiles.filter((t) => !t.video.muted).map((t) => t.name)
const bordered = (tiles: ReturnType<typeof fakeTile>[]): string[] =>
  tiles.filter((t) => t.classes.has('audible')).map((t) => t.name)

describe('AudioController', () => {
  let audio: AudioController
  let a: ReturnType<typeof fakeTile>, b: ReturnType<typeof fakeTile>, c: ReturnType<typeof fakeTile>
  let all: ReturnType<typeof fakeTile>[]

  beforeEach(() => {
    audio = new AudioController()
    ;[a, b, c] = all = [fakeTile('a'), fakeTile('b'), fakeTile('c')]
    for (const t of all) audio.addTile(t)
  })

  it('starts with everyone audible, full volume, and no borders', () => {
    expect(audibleNames(all)).toEqual(['a', 'b', 'c'])
    expect(all.every((t) => t.video.volume === 1)).toBe(true)
    expect(bordered(all)).toEqual([])
    expect(audio.isAllSound).toBe(true)
  })

  it('is not "all sound" with no tiles', () => {
    expect(new AudioController().isAllSound).toBe(false)
  })

  it('solo makes exactly one tile audible and borders it', () => {
    audio.solo(b)
    expect(audibleNames(all)).toEqual(['b'])
    expect(bordered(all)).toEqual(['b'])
    expect(audio.isAllSound).toBe(false)
  })

  it('ctrl-toggle adds and removes tiles from the set', () => {
    audio.solo(a)
    audio.toggleInSet(c)
    expect(audibleNames(all)).toEqual(['a', 'c'])
    expect(bordered(all)).toEqual(['a', 'c'])
    audio.toggleInSet(a)
    expect(audibleNames(all)).toEqual(['c'])
  })

  it('toggling out of the full set leaves a strict subset with borders', () => {
    audio.toggleInSet(b)
    expect(audibleNames(all)).toEqual(['a', 'c'])
    expect(bordered(all)).toEqual(['a', 'c'])
  })

  it('a hand-assembled full set re-enters all mode: no borders, new tiles join', () => {
    audio.solo(a)
    audio.toggleInSet(b)
    audio.toggleInSet(c)
    expect(audio.isAllSound).toBe(true)
    expect(bordered(all)).toEqual([])
    const d = fakeTile('d')
    audio.addTile(d)
    expect(d.video.muted).toBe(false)
  })

  it('new tiles join muted-out while a subset is soloed', () => {
    audio.solo(a)
    const d = fakeTile('d')
    audio.addTile(d)
    expect(d.video.muted).toBe(true)
    expect(bordered([...all, d])).toEqual(['a'])
  })

  it('allSound restores everyone', () => {
    audio.solo(a)
    audio.allSound()
    expect(audibleNames(all)).toEqual(['a', 'b', 'c'])
    expect(bordered(all)).toEqual([])
  })

  it('mute is a layer that preserves the audible set', () => {
    audio.solo(b)
    audio.toggleMute()
    expect(audio.muted).toBe(true)
    expect(audibleNames(all)).toEqual([])
    expect(all.every((t) => t.classes.has('muted-global'))).toBe(true)
    expect(bordered(all)).toEqual(['b'])
    audio.toggleMute()
    expect(audibleNames(all)).toEqual(['b'])
    expect(all.some((t) => t.classes.has('muted-global'))).toBe(false)
  })

  it('removing the only audible tile falls back to all sound', () => {
    audio.solo(b)
    audio.removeTile(b)
    expect(audibleNames([a, c])).toEqual(['a', 'c'])
    expect(audio.isAllSound).toBe(true)
  })

  it('removing a non-audible tile keeps the solo', () => {
    audio.solo(b)
    audio.removeTile(a)
    expect(audibleNames([b, c])).toEqual(['b'])
    expect(audio.isAllSound).toBe(false)
  })

  it('removing a muted-out tile can complete the set', () => {
    audio.toggleInSet(c) // a, b audible
    audio.removeTile(c)
    expect(audio.isAllSound).toBe(true)
    expect(bordered([a, b])).toEqual([])
  })

  it('click from all sound solos the tile', () => {
    audio.click(b)
    expect(audibleNames(all)).toEqual(['b'])
    expect(bordered(all)).toEqual(['b'])
  })

  it('clicking the only audible tile brings everyone back', () => {
    audio.click(b)
    audio.click(b)
    expect(audibleNames(all)).toEqual(['a', 'b', 'c'])
    expect(bordered(all)).toEqual([])
    expect(audio.isAllSound).toBe(true)
  })

  it('clicking an audible tile in a subset turns just it off', () => {
    audio.solo(a)
    audio.toggleInSet(b)
    audio.click(a)
    expect(audibleNames(all)).toEqual(['b'])
    expect(bordered(all)).toEqual(['b'])
  })

  it('clicking a silent tile in a subset solos it', () => {
    audio.solo(a)
    audio.toggleInSet(b)
    audio.click(c)
    expect(audibleNames(all)).toEqual(['c'])
  })

  it('ctrl-toggling out the only audible tile brings everyone back', () => {
    audio.solo(b)
    audio.toggleInSet(b)
    expect(audibleNames(all)).toEqual(['a', 'b', 'c'])
    expect(audio.isAllSound).toBe(true)
  })

  it('the click rules apply unchanged while muted, and stay silent', () => {
    audio.solo(b)
    audio.toggleMute()
    audio.click(b)
    expect(audio.isAllSound).toBe(true)
    expect(audibleNames(all)).toEqual([])
    expect(bordered(all)).toEqual([])
    audio.toggleMute()
    expect(audibleNames(all)).toEqual(['a', 'b', 'c'])
  })

  it('while cycling, every click (Ctrl or not) solos and reports the pick', () => {
    const picks: string[] = []
    audio.onPick = (t) => picks.push(t.name)
    audio.cycling = true
    audio.solo(a)
    audio.click(a)
    expect(audibleNames(all)).toEqual(['a'])
    audio.toggleInSet(c)
    expect(audibleNames(all)).toEqual(['c'])
    audio.click(b)
    expect(audibleNames(all)).toEqual(['b'])
    expect(picks).toEqual(['a', 'c', 'b'])
  })

  it('All sound ends cycling', () => {
    let ended = 0
    audio.onCycleEnd = () => ended++
    audio.cycling = true
    audio.solo(a)
    audio.allSound()
    expect(audio.cycling).toBe(false)
    expect(ended).toBe(1)
    expect(audibleNames(all)).toEqual(['a', 'b', 'c'])
    audio.allSound()
    expect(ended).toBe(1)
  })

  it('soloed lists the audible subset in tile order, or nothing in all sound', () => {
    expect(audio.soloed).toEqual([])
    audio.solo(c)
    audio.toggleInSet(a)
    expect(audio.soloed.map((t) => t.name)).toEqual(['a', 'c'])
  })
})
