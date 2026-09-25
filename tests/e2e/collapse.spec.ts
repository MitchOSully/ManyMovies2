import type { Page } from '@playwright/test'
import { computeLayout } from '../../src/renderer/layout'
import { byName, expect, has, load, playing, stageRect, test, tiles, useApp, waitTime } from './helpers'

const ctx = useApp()

/** Records the name of every tile that ever gains .exiting from now on. */
async function watchExits(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __exits: string[]; __exitObs?: MutationObserver }
    w.__exitObs?.disconnect()
    w.__exits = []
    w.__exitObs = new MutationObserver(() => {
      for (const t of window.mm.tiles) if (t.el.classList.contains('exiting') && !w.__exits.includes(t.name)) w.__exits.push(t.name)
    })
    w.__exitObs.observe(document.getElementById('tiles')!, { subtree: true, attributes: true, attributeFilter: ['class'] })
  })
}
const exits = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __exits: string[] }).__exits)

async function sliderPoint(page: Page, seconds: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('#slider').boundingBox())!
  const max = Number(await page.locator('#slider').getAttribute('max'))
  const inset = 8
  return { x: box.x + inset + (box.width - 2 * inset) * (seconds / max), y: box.y + box.height / 2 }
}

/**
 * Settled: nothing mid-exit, no transition running, no leftover inline geometry.
 * (.flip itself lingers on survivors until the next relayout; that is harmless.)
 */
async function expectSettled(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.mm.tiles
          .filter((t) => t.el.classList.contains('exiting') || t.el.getAnimations().length > 0 || t.el.style.cssText !== '')
          .map((t) => t.name)
      )
    )
    .toEqual([])
}

test('a finished video shrinks out of the grid and the rest grow', async () => {
  await load(ctx.page, ['d3.mp4', 'd12.mp4'])
  const before = byName(await tiles(ctx.page), 'd12.mp4').layoutW
  await watchExits(ctx.page)
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 3.3)
  await expect.poll(async () => has(byName(await tiles(ctx.page), 'd3.mp4'), 'collapsed')).toBe(true)
  const t3 = byName(await tiles(ctx.page), 'd3.mp4')
  expect(t3.finished).toBe(true)
  expect(has(t3, 'finished')).toBe(true)
  await expectSettled(ctx.page)
  const stage = await stageRect(ctx.page)
  const want = computeLayout(1, stage.w, stage.h, 0)
  const after = byName(await tiles(ctx.page), 'd12.mp4').rect.w
  expect(after).toBeGreaterThan(before)
  expect(Math.round(after)).toBe(want.tileW)
  // It animated out rather than vanishing.
  expect(await exits(ctx.page)).toEqual(['d3.mp4'])
  expect(await playing(ctx.page)).toBe(true)
})

test('scrubbing back before its end brings it back to its slot, without animating', async () => {
  await load(ctx.page, ['d3.mp4', 'd8.mp4', 'd12.mp4'])
  await ctx.page.evaluate(() => window.mm.timeline.seek(5))
  await expect.poll(async () => has(byName(await tiles(ctx.page), 'd3.mp4'), 'collapsed')).toBe(true)
  await expectSettled(ctx.page)
  await watchExits(ctx.page)

  const from = await sliderPoint(ctx.page, 5)
  await ctx.page.mouse.move(from.x, from.y)
  await ctx.page.mouse.down()
  const back = await sliderPoint(ctx.page, 1)
  await ctx.page.mouse.move(back.x, back.y, { steps: 6 })
  await expect.poll(async () => has(byName(await tiles(ctx.page), 'd3.mp4'), 'collapsed')).toBe(false)
  // Same slot: first in DOM order and leftmost in the top row.
  const all = await tiles(ctx.page)
  expect(all[0].name).toBe('d3.mp4')
  expect(all[0].rect.x).toBeLessThan(all[1].rect.x)
  expect(all[0].finished).toBe(false)
  // Back out again, still mid-drag: snaps, never animates while scrubbing.
  const fwd = await sliderPoint(ctx.page, 6)
  await ctx.page.mouse.move(fwd.x, fwd.y, { steps: 6 })
  await expect.poll(async () => has(byName(await tiles(ctx.page), 'd3.mp4'), 'collapsed')).toBe(true)
  await ctx.page.mouse.up()
  expect(await exits(ctx.page)).toEqual([])
  await expectSettled(ctx.page)
})

test('seeking past a video\'s end with the arrow keys collapses it', async () => {
  await load(ctx.page, ['d3.mp4', 'd12.mp4'])
  await ctx.page.keyboard.press('ArrowRight')
  await expect.poll(async () => has(byName(await tiles(ctx.page), 'd3.mp4'), 'collapsed')).toBe(true)
  await ctx.page.keyboard.press('ArrowLeft')
  await expect.poll(async () => has(byName(await tiles(ctx.page), 'd3.mp4'), 'collapsed')).toBe(false)
  await expectSettled(ctx.page)
})

test('two clips ending within one animation both leave cleanly', async () => {
  await load(ctx.page, ['d5.mp4', 'd5b.mp4', 'd12.mp4'])
  await ctx.page.evaluate(() => window.mm.timeline.seek(4))
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 5.4)
  await expect
    .poll(async () => (await tiles(ctx.page)).filter((t) => has(t, 'collapsed')).map((t) => t.name))
    .toEqual(['d5.mp4', 'd5b.mp4'])
  await expectSettled(ctx.page)
  const stage = await stageRect(ctx.page)
  const want = computeLayout(1, stage.w, stage.h, 0)
  expect(Math.round(byName(await tiles(ctx.page), 'd12.mp4').rect.w)).toBe(want.tileW)
})

test('when everything has finished, every video reappears on its last frame', async () => {
  await load(ctx.page, ['d3.mp4', 'd5.mp4'])
  await ctx.page.evaluate(() => window.mm.timeline.seek(2))
  await ctx.page.keyboard.press('Space')
  await expect.poll(() => playing(ctx.page), { timeout: 8000 }).toBe(false)
  const all = await tiles(ctx.page)
  expect(all.map((t) => t.finished)).toEqual([true, true])
  expect(all.filter((t) => has(t, 'collapsed'))).toEqual([])
  for (const t of all) expect(t.currentTime, t.name).toBeGreaterThan(t.duration - 0.2)
  await expectSettled(ctx.page)
})

test('an unplayable file does not suppress the end-of-timeline reveal', async () => {
  await load(ctx.page, ['d3.mp4', 'd5.mp4', 'broken.mp4'])
  await ctx.page.evaluate(() => window.mm.timeline.seek(2))
  await ctx.page.keyboard.press('Space')
  await expect.poll(async () => has(byName(await tiles(ctx.page), 'd3.mp4'), 'collapsed')).toBe(true)
  await expect.poll(() => playing(ctx.page), { timeout: 8000 }).toBe(false)
  await expect.poll(async () => (await tiles(ctx.page)).filter((t) => has(t, 'collapsed')).length).toBe(0)
})

test('adding a video after everything finished re-collapses the finished ones', async () => {
  await load(ctx.page, ['d3.mp4'])
  await ctx.page.evaluate(() => window.mm.timeline.seek(3))
  await expect.poll(async () => (await tiles(ctx.page))[0].finished).toBe(true)
  expect(has((await tiles(ctx.page))[0], 'collapsed')).toBe(false)
  await load(ctx.page, ['d8.mp4'])
  await expect.poll(async () => has(byName(await tiles(ctx.page), 'd3.mp4'), 'collapsed')).toBe(true)
  expect(has(byName(await tiles(ctx.page), 'd8.mp4'), 'collapsed')).toBe(false)
})
