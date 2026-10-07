export const STRIP_HEIGHT = 26
export const TILE_GAP = 4

export interface Layout {
  tileW: number
  tileH: number
  cols: number
}

/**
 * Uniform grid: pick the rows*cols arrangement that maximizes tile area for a
 * 16:9 video region (plus the title strip, when shown) within the container.
 */
export function computeLayout(
  n: number,
  w: number,
  h: number,
  stripHeight: number = STRIP_HEIGHT
): Layout {
  let best: Layout & { area: number } = { area: -1, tileW: 320, tileH: 180 + stripHeight, cols: 1 }
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows)
    const cellW = (w - TILE_GAP * (cols + 1)) / cols
    const cellH = (h - TILE_GAP * (rows + 1)) / rows
    const videoH = cellH - stripHeight
    if (cellW <= 0 || videoH <= 0) continue
    const scale = Math.min(cellW / 16, videoH / 9)
    const vw = 16 * scale
    const vh = 9 * scale
    const area = vw * vh
    if (area > best.area) {
      best = { area, tileW: Math.floor(vw), tileH: Math.floor(vh + stripHeight), cols }
    }
  }
  return best
}

/** Most of the stage height the bottom row may take in the large view. */
export const ROW_SHARE = 0.2

export interface LargeLayout {
  largeW: number
  largeH: number
  /** Size of each tile in the bottom row (0×0 when there are none). */
  tileW: number
  tileH: number
}

/**
 * Large view: one big 16:9 video on top, and every other tile in a single row
 * along the bottom. The row never wraps — its tiles shrink to fit the width,
 * and their height is capped at ROW_SHARE of the stage. The big video takes
 * whatever is left above it.
 */
export function computeLargeLayout(
  nSmall: number,
  w: number,
  h: number,
  stripHeight: number = STRIP_HEIGHT
): LargeLayout {
  let tileW = 0
  let tileH = 0
  if (nSmall > 0) {
    const maxVideoH = h * ROW_SHARE - TILE_GAP - stripHeight
    const maxVideoW = (w - TILE_GAP * (nSmall + 1)) / nSmall
    const scale = Math.max(0, Math.min(maxVideoW / 16, maxVideoH / 9))
    tileW = Math.floor(16 * scale)
    tileH = Math.floor(9 * scale + stripHeight)
  }
  const rowH = nSmall > 0 ? tileH + TILE_GAP : 0
  const big = computeLayout(1, w, h - rowH, stripHeight)
  return { largeW: big.tileW, largeH: big.tileH, tileW, tileH }
}
