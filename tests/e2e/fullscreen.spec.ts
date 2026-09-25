import type { Page } from '@playwright/test'
import { expect, load, test, useApp } from './helpers'

const ctx = useApp()

const isFull = (): Promise<boolean> =>
  ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())

async function expectFull(page: Page, on: boolean): Promise<void> {
  await expect.poll(isFull).toBe(on)
  if (on) await expect(page.locator('body')).toHaveClass(/fullscreen/)
  else await expect(page.locator('body')).not.toHaveClass(/fullscreen/)
  if (on) await expect(page.locator('#btn-full')).toHaveClass(/active/)
  else await expect(page.locator('#btn-full')).not.toHaveClass(/active/)
}

test('the ⛶ button enters full screen and Esc leaves it', async () => {
  await load(ctx.page, ['d5.mp4'])
  await ctx.page.locator('#btn-full').click()
  await expectFull(ctx.page, true)
  await expect(ctx.page.locator('#btn-full')).toHaveAttribute('title', 'Exit full screen (F11 / Esc)')
  await ctx.page.keyboard.press('Escape')
  await expectFull(ctx.page, false)
  await expect(ctx.page.locator('#btn-full')).toHaveAttribute('title', 'Full screen (F11)')
})

/**
 * F11 belongs to the default menu's Toggle Full Screen accelerator. Playwright's
 * CDP key events never reach native accelerators, but webContents.sendInputEvent
 * does — so this also proves the renderer doesn't toggle a second time.
 */
const pressF11 = (): Promise<void> =>
  ctx.app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'F11' })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'F11' })
  })

test('F11 toggles full screen once per press', async () => {
  await pressF11()
  await expectFull(ctx.page, true)
  await ctx.page.waitForTimeout(400)
  expect(await isFull()).toBe(true)
  await pressF11()
  await expectFull(ctx.page, false)
  await ctx.page.waitForTimeout(400)
  expect(await isFull()).toBe(false)
})

test('the ⛶ button leaves full screen too', async () => {
  await ctx.page.locator('#btn-full').click()
  await expectFull(ctx.page, true)
  await ctx.page.mouse.move(400, (await ctx.page.evaluate(() => window.innerHeight)) - 10)
  await ctx.page.locator('#btn-full').click()
  await expectFull(ctx.page, false)
})

test('in full screen the grid takes the whole window and the toolbar slides in near the bottom', async () => {
  await load(ctx.page, ['d5.mp4'])
  await ctx.page.locator('#btn-full').click()
  await expectFull(ctx.page, true)
  const body = ctx.page.locator('body')
  const h = await ctx.page.evaluate(() => window.innerHeight)
  await expect
    .poll(() => ctx.page.evaluate(() => document.getElementById('stage')!.getBoundingClientRect().height))
    .toBe(h)

  await ctx.page.mouse.move(400, h / 2)
  await expect(body).not.toHaveClass(/show-controls/)
  await ctx.page.mouse.move(400, h - 20)
  await expect(body).toHaveClass(/show-controls/)
  await expect
    .poll(() => ctx.page.evaluate(() => document.getElementById('controls')!.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(h + 1)
  await ctx.page.mouse.move(400, h / 2)
  await expect(body).not.toHaveClass(/show-controls/)

  await ctx.page.keyboard.press('Escape')
  await expectFull(ctx.page, false)
  await expect(body).not.toHaveClass(/show-controls/)
})

test('Esc outside full screen does nothing', async () => {
  await ctx.page.keyboard.press('Escape')
  await ctx.page.waitForTimeout(300)
  expect(await isFull()).toBe(false)
})
