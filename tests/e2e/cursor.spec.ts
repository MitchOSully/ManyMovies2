import type { Page } from '@playwright/test'
import { CURSOR_IDLE_MS } from '../../src/renderer/cursor'
import { expect, load, test, useApp } from './helpers'

const ctx = useApp()

/** Comfortably past the idle delay. */
const IDLE = CURSOR_IDLE_MS + 1500

const hidden = (p: Page): Promise<boolean> => p.evaluate(() => document.body.classList.contains('cursor-hidden'))

async function enterFull(p: Page): Promise<number> {
  await p.evaluate(() => window.mm.toggleFullScreen())
  await p.waitForFunction(() => document.body.classList.contains('fullscreen'))
  return p.evaluate(() => window.innerHeight)
}

test('in full screen a resting pointer hides; the hover title stays but its buttons go', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4'])
  const h = await enterFull(ctx.page)
  const frame = ctx.page.locator('.tile').nth(0).locator('.frame')
  const box = (await frame.boundingBox())!
  await ctx.page.mouse.move(box.x + box.width / 2, h / 2)
  await expect(frame.locator('.frame-close')).toBeVisible()
  expect(await hidden(ctx.page)).toBe(false)

  await expect.poll(() => hidden(ctx.page), { timeout: IDLE }).toBe(true)
  await expect(frame.locator('.frame-title')).toBeVisible()
  await expect(frame.locator('.frame-close')).toBeHidden()
  await expect(frame.locator('.frame-float')).toBeHidden()
  await expect(frame.locator('.frame-large')).toBeHidden()
  expect(await frame.evaluate((el) => getComputedStyle(el).cursor)).toBe('none')

  // Moving brings it straight back, buttons and all.
  await ctx.page.mouse.move(box.x + box.width / 2 + 5, h / 2)
  expect(await hidden(ctx.page)).toBe(false)
  await expect(frame.locator('.frame-close')).toBeVisible()
})

test('keys and layout changes leave a hidden pointer hidden; a click shows it', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4'])
  const h = await enterFull(ctx.page)
  await ctx.page.mouse.move(400, h / 2)
  await expect.poll(() => hidden(ctx.page), { timeout: IDLE }).toBe(true)

  await ctx.page.keyboard.press('m')
  // Titles on shifts the grid under the pointer.
  await ctx.page.keyboard.press('t')
  await ctx.page.waitForTimeout(300)
  expect(await hidden(ctx.page)).toBe(true)

  await ctx.page.mouse.down()
  expect(await hidden(ctx.page)).toBe(false)
  await ctx.page.mouse.up()
})

test('a mousemove that reports the pointer where it already was does not show it', async () => {
  await load(ctx.page, ['d5.mp4'])
  await enterFull(ctx.page)
  // The window resizing into full screen sends Playwright's pointer a move of its own.
  await ctx.page.waitForTimeout(500)
  const move =(x: number): Promise<boolean> =>
    ctx.page.evaluate((x) => {
      window.dispatchEvent(new MouseEvent('mousemove', { screenX: x, screenY: 300 }))
      return document.body.classList.contains('cursor-hidden')
    }, x)
  await move(500)
  await expect.poll(() => hidden(ctx.page), { timeout: IDLE }).toBe(true)
  expect(await move(500)).toBe(true)
  expect(await move(501)).toBe(false)
})

test('the pointer never hides while the toolbar is showing', async () => {
  await load(ctx.page, ['d5.mp4'])
  const h = await enterFull(ctx.page)
  await ctx.page.mouse.move(400, h - 20)
  await expect(ctx.page.locator('body')).toHaveClass(/show-controls/)
  await ctx.page.waitForTimeout(IDLE)
  expect(await hidden(ctx.page)).toBe(false)

  // Back on the videos, the clock starts again.
  await ctx.page.mouse.move(400, h / 2)
  await expect.poll(() => hidden(ctx.page), { timeout: IDLE }).toBe(true)
})

test('leaving full screen shows the pointer, and outside full screen it never hides', async () => {
  await load(ctx.page, ['d5.mp4'])
  const h = await enterFull(ctx.page)
  await ctx.page.mouse.move(400, h / 2)
  await expect.poll(() => hidden(ctx.page), { timeout: IDLE }).toBe(true)
  await ctx.page.keyboard.press('Escape')
  await ctx.page.waitForFunction(() => !document.body.classList.contains('fullscreen'))
  expect(await hidden(ctx.page)).toBe(false)
  await ctx.page.waitForTimeout(IDLE)
  expect(await hidden(ctx.page)).toBe(false)
})

test('a full-screened float hides its resting pointer too', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4'])
  const tile = ctx.page.locator('.tile').nth(0)
  const opened = ctx.app.waitForEvent('window')
  await tile.locator('.frame').hover()
  await tile.locator('.frame-float').click()
  const fp = await opened
  await fp.waitForFunction(() => !!document.querySelector('.float-host video'))
  const floatHidden = (): Promise<boolean> => hidden(fp)

  // Windowed float: never hides.
  await fp.mouse.move(100, 100)
  await fp.waitForTimeout(IDLE)
  expect(await floatHidden()).toBe(false)

  const name = await ctx.page.evaluate(() => window.mm.floats.nameOf(window.mm.tiles[0]))
  await ctx.page.evaluate((n) => window.api!.setFloatFullScreen(n!, true), name)
  await fp.mouse.move(120, 120)
  await expect.poll(floatHidden, { timeout: IDLE }).toBe(true)
  // The main window is not in full screen and keeps its pointer.
  expect(await hidden(ctx.page)).toBe(false)

  await fp.mouse.move(140, 140)
  expect(await floatHidden()).toBe(false)

  await ctx.page.evaluate((n) => window.api!.setFloatFullScreen(n!, false), name)
  await expect.poll(floatHidden).toBe(false)
  await fp.waitForTimeout(IDLE)
  expect(await floatHidden()).toBe(false)
})
