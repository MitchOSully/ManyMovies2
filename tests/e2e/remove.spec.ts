import { computeLayout, STRIP_HEIGHT } from '../../src/renderer/layout'
import { expect, load, playing, stageRect, test, tiles, time, useApp } from './helpers'

const ctx = useApp()

test('the title-strip ✕ removes a video and the grid relayouts', async () => {
  await load(ctx.page, ['d3.mp4', 'd8.mp4', 'd12.mp4'])
  await ctx.page.keyboard.press('t')
  await ctx.page.locator('.tile').nth(1).locator('.strip-close').click()
  await expect(ctx.page.locator('.tile')).toHaveCount(2)
  expect((await tiles(ctx.page)).map((t) => t.name)).toEqual(['d3.mp4', 'd12.mp4'])
  const stage = await stageRect(ctx.page)
  const want = computeLayout(2, stage.w, stage.h, STRIP_HEIGHT)
  await expect.poll(async () => (await tiles(ctx.page)).map((t) => Math.round(t.rect.w))).toEqual([want.tileW, want.tileW])
})

test('with titles hidden, a hover ✕ removes the video', async () => {
  await load(ctx.page, ['d3.mp4', 'd8.mp4'])
  const tile = ctx.page.locator('.tile').nth(0)
  const close = tile.locator('.frame-close')
  await expect(close).toBeHidden()
  await tile.locator('.frame').hover()
  await expect(close).toBeVisible()
  await expect(tile.locator('.frame-title')).toBeVisible()
  await expect(tile.locator('.frame-title')).toHaveText('d3.mp4')
  await close.click()
  expect((await tiles(ctx.page)).map((t) => t.name)).toEqual(['d8.mp4'])
})

test('clicking ✕ does not also solo the video underneath', async () => {
  await load(ctx.page, ['d3.mp4', 'd8.mp4', 'd12.mp4'])
  await ctx.page.locator('.tile').nth(0).locator('.frame').hover()
  await ctx.page.locator('.tile').nth(0).locator('.frame-close').click()
  expect((await tiles(ctx.page)).filter((t) => t.muted)).toEqual([])
})

test('removing a video updates the timeline duration', async () => {
  await load(ctx.page, ['d5.mp4', 'd12.mp4'])
  await ctx.page.keyboard.press('t')
  await ctx.page.locator('.tile').nth(1).locator('.strip-close').click()
  await expect(ctx.page.locator('#time')).toHaveText('0:00 / 0:05')
})

test('removing every video returns to the empty state and resets the timeline', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4'])
  await ctx.page.keyboard.press('Space')
  await expect.poll(() => time(ctx.page)).toBeGreaterThan(0.5)
  await ctx.page.keyboard.press('t')
  await ctx.page.locator('.tile .strip-close').first().click()
  await ctx.page.locator('.tile .strip-close').first().click()
  await expect(ctx.page.locator('.tile')).toHaveCount(0)
  await expect(ctx.page.locator('#empty')).toBeVisible()
  expect(await playing(ctx.page)).toBe(false)
  await expect(ctx.page.locator('#time')).toHaveText('0:00 / 0:00')
  // Adding again starts from the top.
  await load(ctx.page, ['d3.mp4'])
  expect(await time(ctx.page)).toBe(0)
})
