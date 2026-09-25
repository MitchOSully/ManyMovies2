import { byName, expect, has, load, test, tiles, useApp, waitTime } from './helpers'

const ctx = useApp()

test("an undecodable file shows [CAN'T PLAY] and the rest still play", async () => {
  await load(ctx.page, ['d5.mp4', 'broken.mp4'])
  const bad = ctx.page.locator('.tile').nth(1)
  await expect(bad).toHaveClass(/load-error/)
  const overlay = bad.locator('.error-overlay')
  await expect(overlay).toBeVisible()
  await expect(overlay.locator('span')).toHaveText("[CAN'T PLAY]")
  await expect(overlay.locator('small')).toHaveText(
    /^(loading aborted|network error|decoding failed|format or source not supported)$/
  )
  await expect(ctx.page.locator('.tile').nth(0).locator('.error-overlay')).toBeHidden()

  const t = byName(await tiles(ctx.page), 'broken.mp4')
  expect(t.duration).toBe(0)
  expect(await ctx.page.evaluate(() => window.mm.timeline.duration)).toBeCloseTo(5, 0)
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 1)
  expect(byName(await tiles(ctx.page), 'd5.mp4').paused).toBe(false)
})

test('videos whose audio cannot play get a NO AUDIO badge once they have played', async () => {
  await load(ctx.page, ['d5.mp4', 'noaudio5.mp4', 'ac3audio5.mp4'])
  const badged = async (): Promise<string[]> =>
    (await tiles(ctx.page)).filter((t) => has(t, 'no-audio')).map((t) => t.name)
  expect(await badged()).toEqual([])
  await ctx.page.keyboard.press('Space')
  await expect.poll(badged, { timeout: 6000 }).toEqual(['noaudio5.mp4', 'ac3audio5.mp4'])
  await expect(ctx.page.locator('.tile').nth(1).locator('.no-audio-badge')).toBeVisible()
  await expect(ctx.page.locator('.tile').nth(1).locator('.no-audio-badge')).toHaveText('NO AUDIO')
  await expect(ctx.page.locator('.tile').nth(0).locator('.no-audio-badge')).toBeHidden()
})

test('a muted video with working audio never gets the badge', async () => {
  await load(ctx.page, ['d5.mp4', 'd8.mp4'])
  await ctx.page.keyboard.press('m')
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 2.5)
  expect((await tiles(ctx.page)).filter((t) => has(t, 'no-audio'))).toEqual([])
})
