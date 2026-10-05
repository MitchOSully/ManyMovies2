import { join } from 'path'
import type { Page } from '@playwright/test'
import { DRIFT_RECOVERY_MS, SEEK, SYNC_SPREAD } from './tolerances'
import {
  ROOT,
  basename,
  closeApp,
  expect,
  fx,
  launchApp,
  load,
  playing,
  syncSpread,
  test,
  tiles,
  time,
  useApp,
  waitTime,
  type AppCtx
} from './helpers'

const ctx = useApp()

/** Float the grid tile at `index` via its hover ⧉ button; resolves to the float window's page. */
async function float(c: AppCtx, index: number): Promise<Page> {
  const tile = c.page.locator('.tile:not(.floated)').nth(index)
  const opened = c.app.waitForEvent('window')
  await tile.locator('.frame').hover()
  await tile.locator('.frame-float').click()
  const page = await opened
  await page.waitForFunction(() => !!document.querySelector('.float-host video'))
  return page
}

/** Main-process view of the open float windows (they are the about:blank ones). */
interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

const floatWins = (c: AppCtx): Promise<{ title: string; full: boolean; bounds: Bounds }[]> =>
  c.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL() === 'about:blank')
      .map((w) => ({ title: w.getTitle(), full: w.isFullScreen(), bounds: w.getNormalBounds() }))
  )

const visibleTiles = (p: Page): Promise<string[]> =>
  p.evaluate(() =>
    window.mm.tiles.filter((t) => t.el.offsetParent !== null).map((t) => t.name)
  )

/** The floated tile's video is back at the group's time and playing (it reloads on every move). */
async function expectRejoined(p: Page): Promise<void> {
  await expect
    .poll(() => syncSpread(p), { timeout: DRIFT_RECOVERY_MS + 3000 })
    .toBeLessThan(SYNC_SPREAD)
  await expect.poll(() => p.evaluate(() => window.mm.tiles.every((t) => t.finished || !t.video.paused))).toBe(true)
}

test('⧉ floats a tile into its own window, titled with the filename, and the grid closes up', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4', 'd12.mp4'])
  const before = (await tiles(ctx.page))[0].rect.w
  const fp = await float(ctx, 1)

  await expect.poll(() => floatWins(ctx)).toEqual([expect.objectContaining({ title: 'd8.mp4', full: false })])
  expect(await visibleTiles(ctx.page)).toEqual(['d5.mp4', 'd12.mp4'])
  await expect.poll(async () => (await tiles(ctx.page))[0].rect.w).toBeGreaterThan(before)
  // The tile's own element moved: timeline and audio still drive the same <video>.
  expect(await ctx.page.evaluate(() => window.mm.tiles[1].video.ownerDocument !== document)).toBe(true)
  await expect(fp.locator('.float-host')).toBeVisible()
  await expect(fp.locator('.frame-close')).toBeHidden()
})

test('the strip ⧉ floats too, when titles are shown', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4'])
  await ctx.page.keyboard.press('t')
  const opened = ctx.app.waitForEvent('window')
  await ctx.page.locator('.tile').nth(0).locator('.strip-float').click()
  await opened
  await expect.poll(() => floatWins(ctx)).toEqual([expect.objectContaining({ title: 'd5.mp4' })])
  expect(await visibleTiles(ctx.page)).toEqual(['d8.mp4'])
})

test('floating mid-playback re-joins the group, keeping the rate', async () => {
  await load(ctx.page, ['d12.mp4', 'd8.mp4'])
  await ctx.page.keyboard.press('ArrowUp') // 2×
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 2)
  // Floating the longest video: while it reloads the timeline must neither
  // stop (its duration briefly reads NaN) nor jump back to 0.
  await float(ctx, 0)
  const t0 = await time(ctx.page)
  expect(await playing(ctx.page)).toBe(true)
  await expectRejoined(ctx.page)
  expect(await playing(ctx.page)).toBe(true)
  expect(await time(ctx.page)).toBeGreaterThan(t0)
  // 2× give or take the ±5% drift steering.
  for (const t of await tiles(ctx.page)) expect(Math.abs(t.rate / 2 - 1)).toBeLessThanOrEqual(0.05)
})

test('transport keys pressed in the float drive the main timeline', async () => {
  await load(ctx.page, ['d12.mp4', 'd8.mp4'])
  const fp = await float(ctx, 1)
  await fp.keyboard.press('Space')
  await expect.poll(() => playing(ctx.page)).toBe(true)
  await fp.keyboard.press('Space')
  await expect.poll(() => playing(ctx.page)).toBe(false)
  const t = await time(ctx.page)
  await fp.keyboard.press('ArrowRight')
  await expect.poll(() => time(ctx.page)).toBeGreaterThan(t + 10 - SEEK)
  await fp.keyboard.press('m')
  expect(await ctx.page.evaluate(() => window.mm.audio.muted)).toBe(true)
})

test('click in the float solos it, Ctrl+click toggles it, and the float shows the audible ring', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4', 'd12.mp4'])
  const fp = await float(ctx, 2)
  const host = fp.locator('.float-host')
  const floatFrame = fp.locator('.float-host .frame')
  await floatFrame.click()
  let all = await tiles(ctx.page)
  expect(all.map((t) => !t.muted)).toEqual([false, false, true])
  await expect(host).toHaveClass(/audible/)

  // Ctrl+click a grid tile in, then Ctrl+click the float out.
  await ctx.page.locator('.tile .frame').nth(0).click({ modifiers: ['Control'] })
  await floatFrame.click({ modifiers: ['Control'] })
  all = await tiles(ctx.page)
  expect(all.map((t) => !t.muted)).toEqual([true, false, false])
  await expect(host).not.toHaveClass(/audible/)
})

test('F11 in the float full-screens only the float, and Esc leaves', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4'])
  const fp = await float(ctx, 0)
  // Native menu accelerators only see sendInputEvent, not Playwright's CDP keys.
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === 'about:blank')!
    w.focus()
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' })
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' })
  })
  await expect.poll(async () => (await floatWins(ctx))[0].full).toBe(true)
  const mainFull = await ctx.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => w.webContents.getURL() !== 'about:blank' && w.isFullScreen())
  )
  expect(mainFull).toBe(false)
  await fp.keyboard.press('Escape')
  await expect.poll(async () => (await floatWins(ctx))[0].full).toBe(false)
})

test('closing the float puts the tile back in its grid slot, still in sync', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4', 'd12.mp4'])
  const fp = await float(ctx, 1)
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 1)
  await fp.close()
  await expect.poll(() => floatWins(ctx)).toEqual([])
  await expect.poll(() => visibleTiles(ctx.page)).toEqual(['d5.mp4', 'd8.mp4', 'd12.mp4'])
  expect(await ctx.page.evaluate(() => window.mm.tiles[1].video.ownerDocument === document)).toBe(true)
  await expectRejoined(ctx.page)
})

test('a floated clip that ends holds its last frame in the float, and plays again after a seek back', async () => {
  await load(ctx.page, ['d3.mp4', 'd8.mp4'])
  const fp = await float(ctx, 0)
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 4)
  const short = (await tiles(ctx.page))[0]
  expect(short.finished).toBe(true)
  expect(short.currentTime).toBeGreaterThan(short.duration - 0.2)
  expect(await floatWins(ctx)).toHaveLength(1)
  await expect(fp.locator('.float-host video')).toBeVisible()

  await ctx.page.evaluate(() => window.mm.timeline.seek(1))
  await expect.poll(async () => (await tiles(ctx.page))[0].finished).toBe(false)
  await expect.poll(async () => (await tiles(ctx.page))[0].paused).toBe(false)
})

test('removing a floated tile closes its float', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4'])
  await float(ctx, 0)
  await ctx.page.evaluate(() => window.mm.removeTile(window.mm.tiles[0]))
  await expect.poll(() => floatWins(ctx)).toEqual([])
  expect(await visibleTiles(ctx.page)).toEqual(['d8.mp4'])
})

test('Clear removes floated tiles too and closes their floats', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4', 'd12.mp4'])
  await float(ctx, 0)
  await float(ctx, 0)
  await ctx.page.locator('#btn-clear').click()
  await expect.poll(() => floatWins(ctx)).toEqual([])
  await expect(ctx.page.locator('.tile')).toHaveCount(0)
})

test('several tiles can float at once, cascading off each other', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4', 'd12.mp4'])
  await float(ctx, 0)
  await float(ctx, 0) // d8 is now first in the grid
  const wins = await floatWins(ctx)
  expect(wins.map((w) => w.title).sort()).toEqual(['d5.mp4', 'd8.mp4'])
  expect(wins[0].bounds.x).not.toBe(wins[1].bounds.x)
  expect(await visibleTiles(ctx.page)).toEqual(['d12.mp4'])
})

test('the next float opens where the last one was closed', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4'])
  const fp = await float(ctx, 0)
  const spot = await ctx.app.evaluate(({ BrowserWindow, screen }) => {
    const a = screen.getPrimaryDisplay().workArea
    const b = { x: a.x + 120, y: a.y + 90, width: 640, height: 360 }
    const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === 'about:blank')!
    // Twice: when the float starts on a display with a different scale factor,
    // Windows rescales it on the way over and the first setBounds lands at the wrong size.
    w.setBounds(b)
    w.setBounds(b)
    return b
  })
  await fp.close()
  await expect.poll(() => floatWins(ctx)).toEqual([])
  await float(ctx, 1)
  expect((await floatWins(ctx))[0].bounds).toEqual(spot)
})

test('closing the main window closes its floats and quits', async () => {
  const c = await launchApp()
  await load(c.page, ['d5.mp4', 'd8.mp4'])
  await float(c, 0)
  const closed = c.app.waitForEvent('close')
  await c.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL() !== 'about:blank')!
      .close()
  })
  await closed
  await closeApp(c).catch(() => {})
})

test('without window.api, floating opens a popup and the video keeps playing there', async () => {
  const c = await launchApp()
  const pagePromise = c.app.waitForEvent('window')
  await c.app.evaluate(({ BrowserWindow }, file) => {
    const w = new BrowserWindow({ width: 1000, height: 700 })
    void w.loadFile(file)
  }, join(ROOT, 'out/renderer/index.html'))
  const page = await pagePromise
  await page.waitForFunction(() => !!window.mm)
  await page.locator('#file-input').setInputFiles([fx('d8.mp4'), fx('d5.mp4')])
  await page.waitForFunction(() => window.mm.tiles.every((t) => t.video.readyState >= 3))

  const opened = c.app.waitForEvent('window')
  const tile = page.locator('.tile').nth(0)
  await tile.locator('.frame').hover()
  await tile.locator('.frame-float').click()
  const fp = await opened
  await fp.waitForFunction(() => !!document.querySelector('.float-host video'))
  expect(await fp.title()).toBe(basename(fx('d8.mp4')))
  await fp.keyboard.press('Space')
  await page.waitForFunction(() => window.mm.timeline.currentTime > 1.5)
  await expect.poll(() => syncSpread(page), { timeout: DRIFT_RECOVERY_MS + 3000 }).toBeLessThan(SYNC_SPREAD)
  await closeApp(c)
})
