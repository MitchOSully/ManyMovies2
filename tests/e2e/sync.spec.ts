import { CLOCK_RATE, DRIFT_RECOVERY_MS, SETTLE_MS, STEER_RECOVERY_MS, SYNC_SPREAD } from './tolerances'
import { LONG, expect, load, syncSpread, test, tiles, time, useApp, waitTime } from './helpers'

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

for (const [label, nudge] of [['behind', -0.3], ['ahead', 0.3]] as const) {
  test(`a video slightly ${label} is steered back by playback rate, without a seek`, async () => {
    // Two copies of one 60 s clip: equal length, so tile 0 is the reference.
    await load(ctx.page, LONG.slice(0, 2))
    await ctx.page.keyboard.press('Space')
    await waitTime(ctx.page, 2)
    await ctx.page.evaluate((d) => {
      const v = window.mm.tiles[1].video
      v.currentTime = v.currentTime + d
      // Count drift seeks from here on (the knock above is still in flight).
      v.addEventListener('seeked', () => {
        const w = window as unknown as { driftSeeks: number }
        w.driftSeeks = 0
        v.addEventListener('seeking', () => w.driftSeeks++)
      }, { once: true })
    }, nudge)
    await expect.poll(() => ctx.page.evaluate(() => 'driftSeeks' in window)).toBe(true)
    await expect.poll(() => syncSpread(ctx.page)).toBeGreaterThan(0.2)

    // Steered: faster to catch up, slower to fall back.
    const rate1 = (): Promise<number> => ctx.page.evaluate(() => window.mm.tiles[1].video.playbackRate)
    if (nudge < 0) await expect.poll(rate1).toBeGreaterThan(1)
    else await expect.poll(rate1).toBeLessThan(1)
    await expect
      .poll(() => syncSpread(ctx.page), { timeout: STEER_RECOVERY_MS, intervals: [100] })
      .toBeLessThan(SYNC_SPREAD)
    // Back to exactly the user's rate once converged, and never seeked.
    await expect.poll(rate1, { timeout: STEER_RECOVERY_MS }).toBe(1)
    expect(await ctx.page.evaluate(() => (window as unknown as { driftSeeks: number }).driftSeeks)).toBe(0)
    expect(await syncSpread(ctx.page)).toBeLessThan(SYNC_SPREAD)
  })
}

test('pausing mid-steer restores every video to the user rate', async () => {
  await load(ctx.page, LONG.slice(0, 2))
  await ctx.page.locator('#rate').selectOption('2')
  await ctx.page.locator('#rate').blur()
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 2)
  await ctx.page.evaluate(() => {
    const v = window.mm.tiles[1].video
    v.currentTime = v.currentTime - 0.25 // well under the re-seek threshold, even at 2×
  })
  await expect.poll(() => ctx.page.evaluate(() => window.mm.tiles[1].video.playbackRate)).toBeGreaterThan(2)
  await ctx.page.keyboard.press('Space')
  expect((await tiles(ctx.page)).map((t) => t.rate)).toEqual([2, 2])
})

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
