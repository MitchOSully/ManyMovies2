import type { Page } from '@playwright/test'
import { expect, has, load, openExtras, test, tiles, time, useApp, waitTime } from './helpers'

const ctx = useApp()
// d12 outlasts everything; clip6 finishes at 6 s, so it drops out of the rotation.
const CLIPS = ['d12.mp4', 'd8.mp4', 'clip6.webm']

const frame = (page: Page, i: number) => page.locator('.tile').nth(i).locator('.frame')
/** Which tiles actually output sound. */
async function audible(page: Page): Promise<string[]> {
  return (await tiles(page)).filter((t) => !t.muted && t.volume === 1).map((t) => t.name)
}
/** The current turn's progress (0..1), read off the tile carrying .cycling. */
function progress(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const t = window.mm.tiles.find((t) => t.el.classList.contains('cycling'))
    return t ? parseFloat(t.el.style.getPropertyValue('--cycle-progress')) : null
  })
}

async function startCycle(page: Page): Promise<void> {
  await openExtras(page)
  await page.locator('#btn-cycle').click()
  await page.locator('#btn-cycle').blur()
  await expect(page.locator('#btn-cycle')).toHaveClass(/active/)
}

test('hands the sound on every interval in grid order, skipping finished videos', async () => {
  await load(ctx.page, CLIPS)
  await openExtras(ctx.page)
  await expect(ctx.page.locator('#btn-cycle')).toHaveAttribute('data-icon', 'cycle')
  await expect(ctx.page.locator('#cycle-interval')).toHaveValue('10')
  await ctx.page.locator('#cycle-interval').selectOption('5')
  await startCycle(ctx.page)
  // From all sound, the first video goes first, alone and bordered.
  expect(await audible(ctx.page)).toEqual(['d12.mp4'])
  expect((await tiles(ctx.page)).filter((t) => has(t, 'audible')).map((t) => t.name)).toEqual(['d12.mp4'])

  await ctx.page.evaluate(() => window.mm.timeline.play())
  await expect.poll(() => audible(ctx.page), { timeout: 10_000 }).toEqual(['d8.mp4'])
  expect(await time(ctx.page)).toBeGreaterThan(4.8)
  // d8 ends at 8 s, mid-turn, and hands over at once; clip6 finished at 6 s,
  // so the turn wraps straight back to d12.
  await expect.poll(() => audible(ctx.page), { timeout: 10_000 }).toEqual(['d12.mp4'])
  const t = await time(ctx.page)
  expect(t).toBeGreaterThan(7.8)
  expect(t).toBeLessThan(9.5)
})

test('pausing holds the turn, and seeks do not use it up', async () => {
  await load(ctx.page, CLIPS)
  await ctx.page.evaluate(() => window.mm.cycle.setInterval(2))
  await startCycle(ctx.page)
  // The passing of time is what's under test here.
  await ctx.page.waitForTimeout(2500)
  expect(await audible(ctx.page)).toEqual(['d12.mp4'])
  expect(await progress(ctx.page)).toBe(0)

  await ctx.page.keyboard.press('ArrowRight')
  await ctx.page.evaluate(() => window.mm.timeline.seek(4))
  await ctx.page.waitForTimeout(300)
  expect(await audible(ctx.page)).toEqual(['d12.mp4'])
  expect(await progress(ctx.page)).toBe(0)

  await ctx.page.evaluate(() => window.mm.timeline.play())
  await expect.poll(() => progress(ctx.page)).toBeGreaterThan(0)
  await expect.poll(() => audible(ctx.page), { timeout: 5000 }).toEqual(['d8.mp4'])
  expect(await time(ctx.page)).toBeGreaterThan(5.8)
})

test('a click (Ctrl or not) hands that video the turn with a fresh countdown', async () => {
  await load(ctx.page, CLIPS)
  await startCycle(ctx.page)
  await frame(ctx.page, 2).click()
  expect(await audible(ctx.page)).toEqual(['clip6.webm'])
  await frame(ctx.page, 1).click({ modifiers: ['Control'] })
  expect(await audible(ctx.page)).toEqual(['d8.mp4'])

  await ctx.page.evaluate(() => window.mm.timeline.play())
  await waitTime(ctx.page, 3)
  expect(await progress(ctx.page)).toBeGreaterThan(0.2)
  // Clicking the video that has the turn restarts it.
  await frame(ctx.page, 1).click()
  expect(await audible(ctx.page)).toEqual(['d8.mp4'])
  expect(await progress(ctx.page)).toBeLessThan(0.1)
})

test('All sound ends cycling; the button leaves the current video soloed', async () => {
  await load(ctx.page, CLIPS)
  const btn = ctx.page.locator('#btn-cycle')
  await startCycle(ctx.page)
  await frame(ctx.page, 1).click()
  await btn.click()
  await btn.blur()
  await expect(btn).not.toHaveClass(/active/)
  expect(await audible(ctx.page)).toEqual(['d8.mp4'])
  expect(await progress(ctx.page)).toBeNull()

  // Back on, the soloed video keeps the turn.
  await startCycle(ctx.page)
  expect(await audible(ctx.page)).toEqual(['d8.mp4'])
  await ctx.page.keyboard.press('a')
  await expect(btn).not.toHaveClass(/active/)
  expect(await audible(ctx.page)).toEqual(['d12.mp4', 'd8.mp4', 'clip6.webm'])
  // Out of cycle mode, clicks follow the usual rules again.
  await frame(ctx.page, 0).click()
  await frame(ctx.page, 2).click({ modifiers: ['Control'] })
  expect(await audible(ctx.page)).toEqual(['d12.mp4', 'clip6.webm'])
})

test('removing the video that has the turn hands it straight to the next', async () => {
  await load(ctx.page, CLIPS)
  await startCycle(ctx.page)
  await frame(ctx.page, 1).click()
  // Read in the same task as the removal: no all-sound blip in between.
  expect(
    await ctx.page.evaluate(() => {
      window.mm.removeTile(window.mm.tiles[1])
      return window.mm.tiles.filter((t) => !t.video.muted).map((t) => t.name)
    })
  ).toEqual(['clip6.webm'])
  // The last in line wraps round to the first.
  await ctx.page.evaluate(() => window.mm.removeTile(window.mm.tiles[1]))
  expect(await audible(ctx.page)).toEqual(['d12.mp4'])
})

test('the turn fills a line under the title, shown only with titles on', async () => {
  await load(ctx.page, CLIPS)
  await ctx.page.evaluate(() => window.mm.cycle.setInterval(5))
  await startCycle(ctx.page)
  await ctx.page.evaluate(() => window.mm.timeline.play())
  await waitTime(ctx.page, 2)
  const line = (): Promise<{ strip: boolean; width: number }> =>
    ctx.page.evaluate(() => {
      const strip = window.mm.tiles[0].el.querySelector('.strip')!
      return { strip: strip.getBoundingClientRect().height > 0, width: parseFloat(getComputedStyle(strip, '::after').width) }
    })
  // Titles start hidden, and the line lives in the title strip.
  expect((await line()).strip).toBe(false)
  await ctx.page.keyboard.press('t')
  const first = await line()
  expect(first.strip).toBe(true)
  expect(first.width).toBeGreaterThan(0)
  await expect.poll(async () => (await line()).width).toBeGreaterThan(first.width)
})

test('collapsed, the More-controls toggle flags cycling', async () => {
  await load(ctx.page, ['d8.mp4'])
  const more = ctx.page.locator('#btn-more')
  await ctx.page.evaluate(() => window.mm.cycle.start(window.mm.tiles))
  await expect(more).toHaveClass(/active-dim/)
  await expect(more).toHaveAttribute('title', 'More controls — cycling 10s')
  await ctx.page.evaluate(() => window.mm.cycle.stop())
  await expect(more).not.toHaveClass(/active-dim/)
})
