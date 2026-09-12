export const STRIP_HEIGHT = 26
export const TILE_GAP = 4

export interface Layout {
  tileW: number
  tileH: number
  cols: number
}

/**
 * Uniform grid: pick the rows*cols arrangement that maximizes tile area for a
 * 16:9 video region (plus the title strip) within the given container.
 */
export function computeLayout(n: number, w: number, h: number): Layout {
  let best: Layout & { area: number } = { area: -1, tileW: 320, tileH: 180 + STRIP_HEIGHT, cols: 1 }
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows)
    const cellW = (w - TILE_GAP * (cols + 1)) / cols
    const cellH = (h - TILE_GAP * (rows + 1)) / rows
    const videoH = cellH - STRIP_HEIGHT
    if (cellW <= 0 || videoH <= 0) continue
    const scale = Math.min(cellW / 16, videoH / 9)
    const vw = 16 * scale
    const vh = 9 * scale
    const area = vw * vh
    if (area > best.area) {
      best = { area, tileW: Math.floor(vw), tileH: Math.floor(vh + STRIP_HEIGHT), cols }
    }
  }
  return best
}
