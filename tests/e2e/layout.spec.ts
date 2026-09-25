import type { Page } from '@playwright/test'
import { computeLayout, STRIP_HEIGHT } from '../../src/renderer/layout'
import { MANY, expect, load, stageRect, test, tiles, useApp, type TileState } from './helpers'

const ctx = useApp()

/** Tiles grouped into rows by their top edge. */
function rows(all: TileState[]): TileState[][] {
  const out = new Map<number, TileState[]>()
  for (const t of all) {
    const key = Math.round(t.rect.y)
    out.set(key, [...(out.get(key) ?? []), t])
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r)
}

async function expectGrid(page: Page, n: number, strip: number): Promise<void> {
  const stage = await stageRect(page)
  const want = computeLayout(n, stage.w, stage.h, strip)
  await expect
    .poll(async () => {
      const all = await tiles(page)
      return all.map((t) => [Math.round(t.rect.w), Math.round(t.rect.h)])
    })
    .toEqual(Array(n).fill([want.tileW, want.tileH]))
  const grid = rows(await tiles(page))
  expect(grid[0].length).toBe(want.cols)
  expect(grid.length).toBe(Math.ceil(n / want.cols))
  const stageMid = stage.x + stage.w / 2
  for (const row of grid) {
    // Every row, including a partial last one, is centred on the stage.
    const left = Math.min(...row.map((t) => t.rect.x))
    const right = Math.max(...row.map((t) => t.rect.x + t.rect.w))
    expect(Math.abs((left + right) / 2 - stageMid)).toBeLessThan(2)
    // And laid out in its own bounds.
    expect(left).toBeGreaterThanOrEqual(stage.x)
    expect(right).toBeLessThanOrEqual(stage.x + stage.w)
  }
  const bottom = Math.max(...grid.flat().map((t) => t.rect.y + t.rect.h))
  expect(bottom).toBeLessThanOrEqual(stage.y + stage.h)
}

for (const n of [1, 2, 3, 5, 7]) {
  test(`${n} tile(s) take the computeLayout grid, centred`, async () => {
    await load(ctx.page, MANY.slice(0, n), { wait: false })
    await expectGrid(ctx.page, n, 0)
  })
}

test('relayouts when the window is resized', async () => {
  await load(ctx.page, MANY.slice(0, 4), { wait: false })
  await expectGrid(ctx.page, 4, 0)
  await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 900))
  await expect.poll(async () => (await stageRect(ctx.page)).w).toBeLessThan(900)
  await expectGrid(ctx.page, 4, 0)
  await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 500))
  await expect.poll(async () => (await stageRect(ctx.page)).w).toBeGreaterThan(1500)
  await expectGrid(ctx.page, 4, 0)
})

test('Titles (button and T) toggles the strips and relayouts for them', async () => {
  await load(ctx.page, MANY.slice(0, 3), { wait: false })
  const tilesEl = ctx.page.locator('#tiles')
  const strip = ctx.page.locator('.tile .strip').first()
  await expect(tilesEl).toHaveClass(/no-strips/)
  await expect(strip).toBeHidden()

  await ctx.page.locator('#btn-titles').click()
  await expect(tilesEl).not.toHaveClass(/no-strips/)
  await expect(ctx.page.locator('#btn-titles')).toHaveClass(/active/)
  await expect(strip).toBeVisible()
  await expect(ctx.page.locator('.tile .strip-name').first()).toHaveText('m1.mp4')
  await expectGrid(ctx.page, 3, STRIP_HEIGHT)
  // The video area stays 16:9 below the strip.
  const frame = (await ctx.page.locator('.tile .frame').first().boundingBox())!
  expect(Math.abs(frame.width / frame.height - 16 / 9)).toBeLessThan(0.03)

  await ctx.page.locator('#btn-titles').blur()
  await ctx.page.keyboard.press('t')
  await expect(tilesEl).toHaveClass(/no-strips/)
  await expect(ctx.page.locator('#btn-titles')).not.toHaveClass(/active/)
  await expectGrid(ctx.page, 3, 0)
  await ctx.page.keyboard.press('T')
  await expect(tilesEl).not.toHaveClass(/no-strips/)
})

test('portrait clips letterbox inside a standard tile', async () => {
  await load(ctx.page, ['portrait6.mp4', 'd5.mp4'])
  await expectGrid(ctx.page, 2, 0)
  const v = await ctx.page.evaluate(() => {
    const video = window.mm.tiles[0].video
    return { w: video.videoWidth, h: video.videoHeight, fit: getComputedStyle(video).objectFit }
  })
  expect(v.w).toBeLessThan(v.h)
  expect(v.fit).toBe('contain')
  const [tile, video] = await Promise.all([
    ctx.page.locator('.tile').first().boundingBox(),
    ctx.page.locator('.tile video').first().boundingBox()
  ])
  expect(video!.width).toBeLessThanOrEqual(tile!.width + 0.5)
  expect(video!.height).toBeLessThanOrEqual(tile!.height + 0.5)
})
