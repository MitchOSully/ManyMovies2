import type { Page } from '@playwright/test'
import { SEEK } from './tolerances'
import { expect, load, playing, test, tiles, time, useApp, waitTime } from './helpers'

const ctx = useApp()

async function expectAt(page: Page, t: number): Promise<void> {
  await expect.poll(async () => Math.abs((await time(page)) - t), { message: `timeline at ${t}` }).toBeLessThan(SEEK)
}

async function sliderX(page: Page, fraction: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('#slider').boundingBox())!
  // Native range thumbs inset by about half a thumb at each end.
  const inset = 8
  return { x: box.x + inset + (box.width - 2 * inset) * fraction, y: box.y + box.height / 2 }
}

test('play/pause via the button and Space drives every video', async () => {
  await load(ctx.page, ['d8.mp4', 'd12.mp4'])
  const btn = ctx.page.locator('#btn-play')
  await btn.click()
  await expect(btn).toHaveClass(/playing/)
  expect(await playing(ctx.page)).toBe(true)
  await expect.poll(async () => (await tiles(ctx.page)).map((t) => t.paused)).toEqual([false, false])
  await btn.click()
  await expect(btn).not.toHaveClass(/playing/)
  await expect.poll(async () => (await tiles(ctx.page)).map((t) => t.paused)).toEqual([true, true])

  await btn.blur()
  await ctx.page.keyboard.press('Space')
  await expect(btn).toHaveClass(/playing/)
  await ctx.page.keyboard.press('Space')
  await expect(btn).not.toHaveClass(/playing/)
  expect(await playing(ctx.page)).toBe(false)
})

test('Space toggles exactly once while the play button has focus', async () => {
  await load(ctx.page, ['d12.mp4'])
  await ctx.page.locator('#btn-play').click() // play, and the button keeps focus
  await ctx.page.keyboard.press('Space')
  await ctx.page.waitForTimeout(300)
  expect(await playing(ctx.page)).toBe(false)
})

test('Space with no videos does nothing', async () => {
  await ctx.page.keyboard.press('Space')
  expect(await playing(ctx.page)).toBe(false)
  await expect(ctx.page.locator('#btn-play')).not.toHaveClass(/playing/)
})

test('±10 s via buttons and arrow keys, clamped to the timeline', async () => {
  await load(ctx.page, ['d5.mp4', 'd12.mp4'])
  await ctx.page.evaluate(() => window.mm.timeline.seek(1))
  await ctx.page.locator('#btn-fwd').click()
  await expectAt(ctx.page, 11)
  await ctx.page.locator('#btn-fwd').blur()
  await ctx.page.keyboard.press('ArrowRight')
  await expectAt(ctx.page, 12)
  await ctx.page.keyboard.press('ArrowLeft')
  await expectAt(ctx.page, 2)
  await ctx.page.locator('#btn-back').click()
  await expectAt(ctx.page, 0)
  // Every video follows the seek.
  for (const t of await tiles(ctx.page)) expect(t.currentTime, t.name).toBeLessThan(SEEK)
})

test('speed via the dropdown and ↑/↓, clamped at 0.5× and 2×, applied to every video', async () => {
  await load(ctx.page, ['d8.mp4', 'd12.mp4'])
  const rate = ctx.page.locator('#rate')
  const rates = async (): Promise<number[]> => (await tiles(ctx.page)).map((t) => t.rate)

  await rate.selectOption('2')
  await expect.poll(rates).toEqual([2, 2])
  await rate.blur()
  await ctx.page.keyboard.press('ArrowUp')
  await expect(rate).toHaveValue('2')
  await ctx.page.keyboard.press('ArrowDown')
  await expect(rate).toHaveValue('1')
  await expect.poll(rates).toEqual([1, 1])
  await ctx.page.keyboard.press('ArrowDown')
  await ctx.page.keyboard.press('ArrowDown')
  await expect(rate).toHaveValue('0.5')
  await expect.poll(rates).toEqual([0.5, 0.5])
  await ctx.page.keyboard.press('ArrowUp')
  await expect(rate).toHaveValue('1')
})

test('↑/↓ change speed exactly one step while the dropdown has focus', async () => {
  await load(ctx.page, ['d12.mp4'])
  const rate = ctx.page.locator('#rate')
  await rate.selectOption('1') // leaves focus on the select, as a real pick does
  await rate.focus()
  await ctx.page.keyboard.press('ArrowUp')
  await expect(rate).toHaveValue('2')
  await ctx.page.waitForTimeout(200)
  expect(await ctx.page.evaluate(() => window.mm.timeline.rate)).toBe(2)
})

test('videos added at a non-1× speed inherit it', async () => {
  await load(ctx.page, ['d8.mp4'])
  await ctx.page.locator('#rate').selectOption('0.5')
  await load(ctx.page, ['d12.mp4'])
  expect((await tiles(ctx.page)).map((t) => t.rate)).toEqual([0.5, 0.5])
})

test('time readout shows position and duration', async () => {
  const readout = ctx.page.locator('#time')
  await expect(readout).toHaveText('0:00 / 0:00')
  await load(ctx.page, ['d5.mp4', 'd12.mp4'])
  await expect(readout).toHaveText('0:00 / 0:12')
  await ctx.page.evaluate(() => window.mm.timeline.seek(7.6))
  await expect(readout).toHaveText('0:07 / 0:12')
  const max = await ctx.page.locator('#slider').getAttribute('max')
  expect(Number(max)).toBeCloseTo(12, 1)
})

test('dragging the slider scrubs, pauses underneath, and resumes on release', async () => {
  await load(ctx.page, ['d8.mp4', 'd12.mp4'])
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 0.5)
  const btn = ctx.page.locator('#btn-play')

  const start = await sliderX(ctx.page, 0.25)
  await ctx.page.mouse.move(start.x, start.y)
  await ctx.page.mouse.down()
  expect(await playing(ctx.page)).toBe(false)
  const mid = await sliderX(ctx.page, 0.5)
  await ctx.page.mouse.move(mid.x, mid.y, { steps: 5 })
  await expect.poll(() => time(ctx.page)).toBeGreaterThan(5)
  expect(await time(ctx.page)).toBeLessThan(7)
  // Still showing "playing": a drag is plumbing, not a transport change.
  await expect(btn).toHaveClass(/playing/)
  for (const t of await tiles(ctx.page)) expect(t.paused, t.name).toBe(true)
  const at = await time(ctx.page)
  for (const t of await tiles(ctx.page)) expect(Math.abs(t.currentTime - at), t.name).toBeLessThan(SEEK)

  await ctx.page.mouse.up()
  expect(await playing(ctx.page)).toBe(true)
  await expect.poll(async () => (await tiles(ctx.page)).map((t) => t.paused)).toEqual([false, false])
})

test('dragging the slider while paused stays paused after release', async () => {
  await load(ctx.page, ['d12.mp4'])
  const p = await sliderX(ctx.page, 0.5)
  await ctx.page.mouse.click(p.x, p.y)
  await expect.poll(() => time(ctx.page)).toBeGreaterThan(5)
  expect(await playing(ctx.page)).toBe(false)
  await expect(ctx.page.locator('#btn-play')).not.toHaveClass(/playing/)
})

test('playback stops at the end, and play from the end restarts at 0', async () => {
  await load(ctx.page, ['d3.mp4'])
  await ctx.page.keyboard.press('Space')
  await expect.poll(() => playing(ctx.page), { timeout: 8000 }).toBe(false)
  expect(await time(ctx.page)).toBeGreaterThan(2.9)
  await expect(ctx.page.locator('#btn-play')).not.toHaveClass(/playing/)

  await ctx.page.keyboard.press('Space')
  expect(await playing(ctx.page)).toBe(true)
  await expect.poll(async () => (await tiles(ctx.page))[0].currentTime).toBeLessThan(1)
})
