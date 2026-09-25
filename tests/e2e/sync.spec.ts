import { CLOCK_RATE, DRIFT_RECOVERY_MS, SETTLE_MS, SYNC_SPREAD } from './tolerances'
import { expect, load, syncSpread, test, time, useApp, waitTime } from './helpers'

const ctx = useApp()
const CLIPS = ['d8.mp4', 'd12.mp4', 'clip6.webm', 'endmoov8.mp4']

for (const rate of [1, 2]) {
  test(`videos stay in sync and the timeline tracks the wall clock at ${rate}×`, async () => {
    await load(ctx.page, CLIPS)
    await ctx.page.locator('#rate').selectOption(String(rate))
    await ctx.page.locator('#rate').blur()
    await ctx.page.keyboard.press('Space')
    await ctx.page.waitForTimeout(SETTLE_MS / rate)

    const t0 = await time(ctx.page)
    const w0 = Date.now()
    await ctx.page.waitForTimeout(2000 / rate)
    const advanced = (await time(ctx.page)) - t0
    const wall = ((Date.now() - w0) / 1000) * rate
    expect(Math.abs(advanced - wall) / wall).toBeLessThan(CLOCK_RATE)
    expect(await syncSpread(ctx.page)).toBeLessThan(SYNC_SPREAD)
  })
}

for (const [label, nudge] of [['ahead', 1.2], ['behind', -1.2]] as const) {
  test(`a video knocked ${label} of the group is pulled back`, async () => {
    await load(ctx.page, CLIPS)
    await ctx.page.keyboard.press('Space')
    await waitTime(ctx.page, 2)
    // Nudge a short tile: the longest one is the reference clock.
    await ctx.page.evaluate((d) => {
      const v = window.mm.tiles[0].video
      v.currentTime = v.currentTime + d
    }, nudge)
    await expect.poll(() => syncSpread(ctx.page)).toBeGreaterThan(1)
    await expect
      .poll(() => syncSpread(ctx.page), { timeout: DRIFT_RECOVERY_MS, intervals: [100] })
      .toBeLessThan(SYNC_SPREAD * 2)
  })
}

test('a stray-paused (non-reference) video is restarted by drift correction', async () => {
  await load(ctx.page, CLIPS)
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 1)
  await ctx.page.evaluate(() => window.mm.tiles[0].video.pause())
  await expect
    .poll(() => ctx.page.evaluate(() => window.mm.tiles[0].video.paused), { timeout: DRIFT_RECOVERY_MS })
    .toBe(false)
  await expect.poll(() => syncSpread(ctx.page), { timeout: DRIFT_RECOVERY_MS }).toBeLessThan(SYNC_SPREAD * 2)
})

test('the longest video is the reference: moving it moves the timeline', async () => {
  await load(ctx.page, ['d5.mp4', 'd12.mp4'])
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 1)
  // A small jump within the trust window on the reference carries the clock with it.
  await ctx.page.evaluate(() => {
    const v = window.mm.tiles[1].video
    v.currentTime = v.currentTime + 0.6
  })
  await expect
    .poll(async () => Math.abs((await time(ctx.page)) - (await ctx.page.evaluate(() => window.mm.tiles[1].video.currentTime))))
    .toBeLessThan(0.05)
  await expect.poll(() => syncSpread(ctx.page), { timeout: DRIFT_RECOVERY_MS }).toBeLessThan(SYNC_SPREAD * 2)
})
