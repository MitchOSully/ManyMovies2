import type { Page } from '@playwright/test'
import { byName, expect, has, load, test, tiles, useApp, waitTime, type AppCtx, type TileState } from './helpers'

const ctx = useApp()
const CLIPS = ['d8.mp4', 'd12.mp4', 'clip6.webm', 'd5.mp4']

const tile = (page: Page, i: number) => page.locator('.tile').nth(i)
const frame = (page: Page, i: number) => tile(page, i).locator('.frame')

/** Clicks tile i's large-view button (the hover one: titles are off by default). */
async function largeButton(page: Page, i: number): Promise<void> {
  await frame(page, i).hover()
  await tile(page, i).locator('.frame-large').click()
}

const largeName = (page: Page): Promise<string | null> => page.evaluate(() => window.mm.large?.name ?? null)

async function state(page: Page): Promise<{ audible: string[]; bordered: string[] }> {
  const all = await tiles(page)
  return {
    audible: all.filter((t) => !t.muted).map((t) => t.name),
    bordered: all.filter((t) => has(t, 'audible')).map((t) => t.name)
  }
}

/** Tiles once every FLIP transition has finished, so rects are final. */
async function settled(page: Page): Promise<TileState[]> {
  await expect
    .poll(() => page.evaluate(() => window.mm.tiles.some((t) => t.el.getAnimations().length > 0 || t.el.style.transform !== '')))
    .toBe(false)
  return tiles(page)
}

/** The large tile sits above a single row holding everyone else in grid order. */
async function expectLargeLayout(page: Page, large: string, row: string[]): Promise<void> {
  const all = (await settled(page)).filter((t) => !has(t, 'collapsed'))
  const big = byName(all, large)
  const small = all.filter((t) => t !== big)
  expect(small.map((t) => t.name)).toEqual(row)
  for (const t of small) {
    expect(t.rect.y).toBeGreaterThanOrEqual(big.rect.y + big.rect.h)
    expect(Math.abs(t.rect.y - small[0].rect.y)).toBeLessThan(1)
    expect(t.rect.w).toBeLessThan(big.rect.w / 2)
  }
  const xs = small.map((t) => t.rect.x)
  expect(xs).toEqual([...xs].sort((a, b) => a - b))
}

test('the button makes a video large above a row of the others, soloed without a border', async () => {
  await load(ctx.page, CLIPS)
  await largeButton(ctx.page, 1)
  expect(await largeName(ctx.page)).toBe('d12.mp4')
  await expectLargeLayout(ctx.page, 'd12.mp4', ['d8.mp4', 'clip6.webm', 'd5.mp4'])
  await expect(tile(ctx.page, 1).locator('.frame-large')).toHaveAttribute('data-icon', 'arrows-minimize')
  await expect(tile(ctx.page, 1).locator('.strip-large')).toHaveAttribute('data-icon', 'arrows-minimize')
  await expect(tile(ctx.page, 0).locator('.frame-large')).toHaveAttribute('data-icon', 'arrows-maximize')
  expect(await state(ctx.page)).toEqual({ audible: ['d12.mp4'], bordered: [] })

  // Sharing audio brings the border back, so the mix is visible.
  await frame(ctx.page, 0).click({ modifiers: ['Control'] })
  expect(await state(ctx.page)).toEqual({ audible: ['d8.mp4', 'd12.mp4'], bordered: ['d8.mp4', 'd12.mp4'] })
  // Single clicks and All sound still work as usual.
  await frame(ctx.page, 2).click()
  expect(await state(ctx.page)).toEqual({ audible: ['clip6.webm'], bordered: ['clip6.webm'] })
  await ctx.page.keyboard.press('a')
  expect((await state(ctx.page)).bordered).toEqual([])
})

test('a small video\'s button swaps it in; the old one goes back to its grid position', async () => {
  await load(ctx.page, CLIPS)
  await largeButton(ctx.page, 1)
  await largeButton(ctx.page, 2)
  expect(await largeName(ctx.page)).toBe('clip6.webm')
  await expectLargeLayout(ctx.page, 'clip6.webm', ['d8.mp4', 'd12.mp4', 'd5.mp4'])
  expect(await state(ctx.page)).toEqual({ audible: ['clip6.webm'], bordered: [] })
  await expect(tile(ctx.page, 1).locator('.frame-large')).toHaveAttribute('data-icon', 'arrows-maximize')

  // The large one's button goes back to the grid; audio stays, border returns.
  await largeButton(ctx.page, 2)
  expect(await largeName(ctx.page)).toBeNull()
  const all = await settled(ctx.page)
  expect(all.some((t) => has(t, 'large'))).toBe(false)
  expect(new Set(all.map((t) => Math.round(t.rect.w))).size).toBe(1)
  expect(await state(ctx.page)).toEqual({ audible: ['clip6.webm'], bordered: ['clip6.webm'] })
})

test('double-click enters and leaves the large view without its clicks touching audio', async () => {
  await load(ctx.page, CLIPS)
  await frame(ctx.page, 0).click()
  await frame(ctx.page, 2).click({ modifiers: ['Control'] })
  await frame(ctx.page, 1).dblclick()
  expect(await largeName(ctx.page)).toBe('d12.mp4')
  expect(await state(ctx.page)).toEqual({ audible: ['d12.mp4'], bordered: [] })
  await expectLargeLayout(ctx.page, 'd12.mp4', ['d8.mp4', 'clip6.webm', 'd5.mp4'])

  // A shared set is the case where the two clicks alone would end up soloing it.
  await frame(ctx.page, 0).click({ modifiers: ['Control'] })
  await frame(ctx.page, 1).dblclick()
  expect(await largeName(ctx.page)).toBeNull()
  expect(await state(ctx.page)).toEqual({ audible: ['d8.mp4', 'd12.mp4'], bordered: ['d8.mp4', 'd12.mp4'] })

  // Double-clicking a small tile swaps it in.
  await frame(ctx.page, 1).dblclick()
  await frame(ctx.page, 3).dblclick()
  expect(await largeName(ctx.page)).toBe('d5.mp4')
  expect(await state(ctx.page)).toEqual({ audible: ['d5.mp4'], bordered: [] })
})

test('Esc leaves the large view first, then full screen', async () => {
  await load(ctx.page, CLIPS)
  await largeButton(ctx.page, 0)
  await ctx.page.evaluate(() => window.mm.toggleFullScreen())
  await ctx.page.waitForFunction(() => document.body.classList.contains('fullscreen'))
  await ctx.page.keyboard.press('Escape')
  expect(await largeName(ctx.page)).toBeNull()
  await expect(ctx.page.locator('body')).toHaveClass(/fullscreen/)
  await ctx.page.keyboard.press('Escape')
  await expect(ctx.page.locator('body')).not.toHaveClass(/fullscreen/)
})

/** Floats tile `index` via its hover button; resolves to the float window's page. */
async function floatTile(c: AppCtx, index: number): Promise<Page> {
  const opened = c.app.waitForEvent('window')
  await frame(c.page, index).hover()
  await tile(c.page, index).locator('.frame-float').click()
  const page = await opened
  await page.waitForFunction(() => !!document.querySelector('.float-host video'))
  return page
}

test('floating or removing the large video returns to the grid', async () => {
  await load(ctx.page, CLIPS)
  await largeButton(ctx.page, 1)
  await floatTile(ctx, 1)
  expect(await largeName(ctx.page)).toBeNull()
  await expect(ctx.page.locator('.tile.large')).toHaveCount(0)

  await largeButton(ctx.page, 0)
  expect(await largeName(ctx.page)).toBe('d8.mp4')
  await ctx.page.evaluate(() => window.mm.removeTile(window.mm.tiles[0]))
  expect(await largeName(ctx.page)).toBeNull()
  await expect(ctx.page.locator('#tiles')).not.toHaveClass(/large-mode/)
})

test('double-clicking inside a float window does nothing', async () => {
  await load(ctx.page, CLIPS)
  const float = await floatTile(ctx, 0)
  await float.locator('.frame').dblclick()
  expect(await largeName(ctx.page)).toBeNull()
  await expect(ctx.page.locator('.tile.large')).toHaveCount(0)
})

test('a finished large video stays large while finished small ones leave the row', async () => {
  await load(ctx.page, ['d3.mp4', 'd5.mp4', 'd12.mp4'])
  await largeButton(ctx.page, 0)
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 5.6)
  await ctx.page.keyboard.press('Space')
  const all = await settled(ctx.page)
  expect(byName(all, 'd3.mp4').finished).toBe(true)
  expect(has(byName(all, 'd3.mp4'), 'collapsed')).toBe(false)
  expect(has(byName(all, 'd3.mp4'), 'large')).toBe(true)
  expect(has(byName(all, 'd5.mp4'), 'collapsed')).toBe(true)
  await expectLargeLayout(ctx.page, 'd3.mp4', ['d12.mp4'])
})

test('while cycling, making a video large picks it', async () => {
  await load(ctx.page, CLIPS)
  await ctx.page.evaluate(() => window.mm.cycle.start(window.mm.tiles))
  await largeButton(ctx.page, 2)
  await expect(tile(ctx.page, 2)).toHaveClass(/cycling/)
  expect((await state(ctx.page)).audible).toEqual(['clip6.webm'])
})

test('with a single video in the grid the feature is off', async () => {
  await load(ctx.page, ['d8.mp4'])
  await frame(ctx.page, 0).hover()
  await expect(tile(ctx.page, 0).locator('.frame-large')).toBeHidden()
  await frame(ctx.page, 0).dblclick()
  expect(await largeName(ctx.page)).toBeNull()

  // Two videos, one floated: still only one in the grid.
  await load(ctx.page, ['d12.mp4'])
  await floatTile(ctx, 1)
  await frame(ctx.page, 0).hover()
  await expect(tile(ctx.page, 0).locator('.frame-large')).toBeHidden()
  await frame(ctx.page, 0).dblclick()
  expect(await largeName(ctx.page)).toBeNull()
})

test('removing down to one video leaves the large view', async () => {
  await load(ctx.page, ['d8.mp4', 'd12.mp4'])
  await largeButton(ctx.page, 1)
  expect(await largeName(ctx.page)).toBe('d12.mp4')
  await ctx.page.evaluate(() => window.mm.removeTile(window.mm.tiles[0]))
  expect(await largeName(ctx.page)).toBeNull()
  await expect(ctx.page.locator('.tile.large')).toHaveCount(0)
})
