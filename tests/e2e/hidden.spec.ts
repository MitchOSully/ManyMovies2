import type { Page } from '@playwright/test'
import { byName, expect, has, load, playing, test, tiles, useApp, waitTime } from './helpers'

const ctx = useApp()

/**
 * Puts the renderer into the state a minimized window is in: document.hidden
 * and no animation frames. A real minimize can't be used — Playwright's CDP
 * session keeps the page "visible" and rAF running even when the window is
 * minimized. Only the app's 250 ms interval is left to drive the timeline.
 * Frames requested meanwhile are queued and released by `unhide`.
 */
async function hide(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __raf: typeof requestAnimationFrame; __rafQueue: FrameRequestCallback[] }
    w.__raf = window.requestAnimationFrame
    w.__rafQueue = []
    window.requestAnimationFrame = (cb) => (w.__rafQueue.push(cb), 0)
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
  })
  // Let any frame already in flight run out.
  await page.waitForTimeout(100)
}

async function unhide(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __raf: typeof requestAnimationFrame; __rafQueue: FrameRequestCallback[] }
    delete (document as unknown as { hidden?: boolean }).hidden
    window.requestAnimationFrame = w.__raf
    for (const cb of w.__rafQueue.splice(0)) w.__raf(cb)
  })
}

test.afterEach(async () => {
  await unhide(ctx.page).catch(() => {})
})

test('while hidden, the timeline keeps running and finished videos collapse without animating', async () => {
  await load(ctx.page, ['d3.mp4', 'd12.mp4'])
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 1)
  await hide(ctx.page)
  const frames = await ctx.page.evaluate(() => (window as unknown as { __rafQueue: unknown[] }).__rafQueue.length)
  expect(frames).toBe(1) // the rAF loop is parked
  await waitTime(ctx.page, 4)
  await expect.poll(async () => has(byName(await tiles(ctx.page), 'd3.mp4'), 'collapsed')).toBe(true)
  const t3 = byName(await tiles(ctx.page), 'd3.mp4')
  expect(t3.finished).toBe(true)
  expect(has(t3, 'exiting')).toBe(false)
  expect(await playing(ctx.page)).toBe(true)
  // The slider and readout are kept current by the interval too.
  const slider = Number(await ctx.page.locator('#slider').inputValue())
  expect(slider).toBeGreaterThan(3.5)
})

test('while hidden, playback stops at the end and every video is revealed', async () => {
  await load(ctx.page, ['d3.mp4', 'd5.mp4'])
  await ctx.page.evaluate(() => window.mm.timeline.seek(2))
  await ctx.page.keyboard.press('Space')
  await hide(ctx.page)
  await expect.poll(() => playing(ctx.page), { timeout: 8000 }).toBe(false)
  await expect
    .poll(async () => (await tiles(ctx.page)).filter((t) => has(t, 'collapsed') || has(t, 'exiting')).length)
    .toBe(0)
  expect((await tiles(ctx.page)).map((t) => t.finished)).toEqual([true, true])
})

test('a real minimize/restore round-trip leaves playback running', async () => {
  await load(ctx.page, ['d12.mp4'])
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 0.5)
  await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
  await ctx.page.waitForTimeout(1500)
  await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
  expect(await playing(ctx.page)).toBe(true)
  await waitTime(ctx.page, 2)
})
