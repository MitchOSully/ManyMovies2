import { SEEK } from './tolerances'
import { basename, byName, expect, fx, has, load, test, tiles, time, useApp, waitTime } from './helpers'

const ctx = useApp()

test('shows the empty state until videos are added', async () => {
  const empty = ctx.page.locator('#empty')
  await expect(empty).toBeVisible()
  await load(ctx.page, ['d3.mp4'])
  await expect(empty).toBeHidden()
  await expect(ctx.page.locator('.tile')).toHaveCount(1)
  await expect(ctx.page.locator('.tile .strip-name')).toHaveText('d3.mp4')
})

test('loads mp4, webm, mkv and mov, and all of them play', async () => {
  const names = ['d5.mp4', 'clip6.webm', 'clip6.mkv', 'clip6.mov']
  await load(ctx.page, names)
  let all = await tiles(ctx.page)
  expect(all.map((t) => t.error)).toEqual([null, null, null, null])
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 1)
  all = await tiles(ctx.page)
  for (const t of all) expect(t.currentTime, t.name).toBeGreaterThan(0.5)
})

test('a video added mid-session joins at the current time and plays', async () => {
  await load(ctx.page, ['d12.mp4'])
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 3)
  await load(ctx.page, ['d8.mp4'])
  await expect
    .poll(async () => {
      const t = byName(await tiles(ctx.page), 'd8.mp4')
      return !t.paused && Math.abs(t.currentTime - (await time(ctx.page))) < 0.35
    })
    .toBe(true)
})

test('a video added past its own end arrives finished and collapsed', async () => {
  await load(ctx.page, ['d12.mp4'])
  await ctx.page.evaluate(() => window.mm.timeline.seek(9))
  await load(ctx.page, ['d3.mp4'])
  await expect
    .poll(async () => {
      const t = byName(await tiles(ctx.page), 'd3.mp4')
      return t.finished && has(t, 'collapsed')
    })
    .toBe(true)
  expect(Math.abs((await time(ctx.page)) - 9)).toBeLessThan(SEEK)
})

test('expandPaths expands folders by extension, case-insensitively, without recursing', async () => {
  const out = await ctx.page.evaluate(
    (paths) => window.api!.expandPaths(paths),
    [fx('folder'), fx('d3.mp4'), fx('folder/notes.txt'), fx('does-not-exist.mp4'), fx('folder/sub/nested.mp4')]
  )
  expect(out.map(basename).sort()).toEqual(['C.MKV', 'a.mp4', 'b.webm', 'd3.mp4', 'nested.mp4'])
  // Folder contents come first, in the order given.
  expect(out.slice(0, 3).map(basename).sort()).toEqual(['C.MKV', 'a.mp4', 'b.webm'])
})
