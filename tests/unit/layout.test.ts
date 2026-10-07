import { describe, expect, it } from 'vitest'
import { computeLargeLayout, computeLayout, ROW_SHARE, STRIP_HEIGHT, TILE_GAP } from '../../src/renderer/layout'

const rowsFor = (n: number, cols: number): number => Math.ceil(n / cols)

describe('computeLayout', () => {
  it('fills a 16:9 container with one tile, leaving only the gaps', () => {
    const l = computeLayout(1, 1280, 720, 0)
    expect(l.cols).toBe(1)
    // Height-bound: (720 - 2*gap) / 9 * 16
    expect(l.tileH).toBe(Math.floor(720 - 2 * TILE_GAP))
    expect(l.tileW).toBe(Math.floor(((720 - 2 * TILE_GAP) / 9) * 16))
  })

  it('arranges 4 tiles 2x2 in a 16:9 container', () => {
    expect(computeLayout(4, 1280, 720, 0).cols).toBe(2)
  })

  it('goes single-row in a very wide container and single-column in a tall one', () => {
    expect(computeLayout(3, 3000, 400, 0).cols).toBe(3)
    expect(computeLayout(3, 400, 2000, 0).cols).toBe(1)
  })

  it('adds the title strip on top of a 16:9 video area', () => {
    const l = computeLayout(2, 1280, 720, STRIP_HEIGHT)
    const videoH = l.tileH - STRIP_HEIGHT
    expect(Math.abs(l.tileW / videoH - 16 / 9)).toBeLessThan(0.02)
    const bare = computeLayout(2, 1280, 720, 0)
    expect(l.tileW).toBeLessThanOrEqual(bare.tileW)
  })

  it('defaults the strip height to STRIP_HEIGHT', () => {
    expect(computeLayout(3, 1280, 720)).toEqual(computeLayout(3, 1280, 720, STRIP_HEIGHT))
  })

  const containers: [number, number][] = [
    [1280, 740],
    [1920, 1040],
    [800, 600],
    [480, 300],
    [3000, 500],
    [500, 1500]
  ]
  for (const [w, h] of containers) {
    for (const strip of [0, STRIP_HEIGHT]) {
      it(`fits and is optimal for n=1..12 in ${w}x${h} (strip ${strip})`, () => {
        for (let n = 1; n <= 12; n++) {
          const l = computeLayout(n, w, h, strip)
          const rows = rowsFor(n, l.cols)
          expect(l.cols).toBeGreaterThanOrEqual(1)
          expect(l.cols).toBeLessThanOrEqual(n)
          // Never overflows the container.
          expect(l.cols * l.tileW + (l.cols + 1) * TILE_GAP).toBeLessThanOrEqual(w + 0.001)
          expect(rows * l.tileH + (rows + 1) * TILE_GAP).toBeLessThanOrEqual(h + 0.001)
          // No other row count yields a bigger tile.
          for (let r = 1; r <= n; r++) {
            const c = Math.ceil(n / r)
            const cellW = (w - TILE_GAP * (c + 1)) / c
            const videoH = (h - TILE_GAP * (r + 1)) / r - strip
            if (cellW <= 0 || videoH <= 0) continue
            const altW = 16 * Math.min(cellW / 16, videoH / 9)
            expect(Math.floor(altW)).toBeLessThanOrEqual(l.tileW)
          }
        }
      })
    }
  }

  it('falls back to a default tile when nothing fits', () => {
    expect(computeLayout(0, 1280, 720, 0)).toMatchObject({ tileW: 320, tileH: 180, cols: 1 })
    expect(computeLayout(3, 5, 5, 26)).toMatchObject({ tileW: 320, tileH: 206, cols: 1 })
  })
})

describe('computeLargeLayout', () => {
  for (const strip of [0, STRIP_HEIGHT]) {
    it(`keeps 16:9, one row within the width and the height cap (strip ${strip})`, () => {
      const [w, h] = [1280, 744]
      for (let n = 1; n <= 30; n++) {
        const l = computeLargeLayout(n, w, h, strip)
        expect(Math.abs(l.tileW / (l.tileH - strip) - 16 / 9)).toBeLessThan(0.1)
        expect(Math.abs(l.largeW / (l.largeH - strip) - 16 / 9)).toBeLessThan(0.02)
        // One row: every small tile fits across the width.
        expect(n * l.tileW + (n + 1) * TILE_GAP).toBeLessThanOrEqual(w + 0.001)
        expect(l.tileH + TILE_GAP).toBeLessThanOrEqual(h * ROW_SHARE + 0.001)
        // Big video, row and three gaps fit the height.
        expect(l.largeH + l.tileH + 3 * TILE_GAP).toBeLessThanOrEqual(h + 0.001)
        expect(l.largeW).toBeGreaterThan(l.tileW)
      }
    })
  }

  it('narrows the row tiles once they no longer fit at the capped height', () => {
    const few = computeLargeLayout(2, 1280, 744, 0)
    const many = computeLargeLayout(20, 1280, 744, 0)
    expect(few.tileH).toBe(Math.floor(744 * ROW_SHARE - TILE_GAP))
    expect(many.tileW).toBeLessThan(few.tileW)
  })

  it('with nothing in the row, the big video gets the whole stage', () => {
    const l = computeLargeLayout(0, 1280, 720, 0)
    expect(l).toMatchObject({ tileW: 0, tileH: 0 })
    expect(l.largeW).toBe(computeLayout(1, 1280, 720, 0).tileW)
  })
})
