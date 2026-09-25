import type { Page } from '@playwright/test'
import { expect, has, load, test, tiles, useApp } from './helpers'

const ctx = useApp()
const CLIPS = ['d8.mp4', 'd12.mp4', 'clip6.webm']

const frame = (page: Page, i: number) => page.locator('.tile').nth(i).locator('.frame')
/** Which tiles actually output sound, and which show the audible border. */
async function state(page: Page): Promise<{ audible: string[]; bordered: string[] }> {
  const all = await tiles(page)
  return {
    audible: all.filter((t) => !t.muted && t.volume === 1).map((t) => t.name),
    bordered: all.filter((t) => has(t, 'audible')).map((t) => t.name)
  }
}

test('everyone is audible by default, with no borders', async () => {
  await load(ctx.page, CLIPS)
  expect(await state(ctx.page)).toEqual({ audible: ['d8.mp4', 'd12.mp4', 'clip6.webm'], bordered: [] })
  await expect(ctx.page.locator('#btn-all')).toHaveClass(/active/)
})

test('clicking a video solos it', async () => {
  await load(ctx.page, CLIPS)
  await frame(ctx.page, 1).click()
  expect(await state(ctx.page)).toEqual({ audible: ['d12.mp4'], bordered: ['d12.mp4'] })
  await expect(ctx.page.locator('#btn-all')).not.toHaveClass(/active/)
  await frame(ctx.page, 2).click()
  expect(await state(ctx.page)).toEqual({ audible: ['clip6.webm'], bordered: ['clip6.webm'] })
})

test('Ctrl+click adds and removes videos from the audible set', async () => {
  await load(ctx.page, CLIPS)
  await frame(ctx.page, 0).click()
  await frame(ctx.page, 2).click({ modifiers: ['Control'] })
  expect(await state(ctx.page)).toEqual({ audible: ['d8.mp4', 'clip6.webm'], bordered: ['d8.mp4', 'clip6.webm'] })
  await frame(ctx.page, 0).click({ modifiers: ['Control'] })
  expect(await state(ctx.page)).toEqual({ audible: ['clip6.webm'], bordered: ['clip6.webm'] })
})

test('hand-assembling the full set via Ctrl+click is "all sound"', async () => {
  await load(ctx.page, CLIPS)
  await frame(ctx.page, 0).click()
  await frame(ctx.page, 1).click({ modifiers: ['Control'] })
  await frame(ctx.page, 2).click({ modifiers: ['Control'] })
  expect(await state(ctx.page)).toEqual({ audible: ['d8.mp4', 'd12.mp4', 'clip6.webm'], bordered: [] })
  await expect(ctx.page.locator('#btn-all')).toHaveClass(/active/)
  // ...so a newly added video joins the audible set.
  await load(ctx.page, ['d5.mp4'])
  expect((await state(ctx.page)).audible).toContain('d5.mp4')
})

test('a video added while a subset is soloed stays silent', async () => {
  await load(ctx.page, CLIPS)
  await frame(ctx.page, 0).click()
  await load(ctx.page, ['d5.mp4'])
  expect(await state(ctx.page)).toEqual({ audible: ['d8.mp4'], bordered: ['d8.mp4'] })
})

test('All sound (button and A) restores everyone', async () => {
  await load(ctx.page, CLIPS)
  await frame(ctx.page, 0).click()
  await ctx.page.locator('#btn-all').click()
  expect((await state(ctx.page)).audible).toHaveLength(3)
  await ctx.page.locator('#btn-all').blur()
  await frame(ctx.page, 1).click()
  await ctx.page.keyboard.press('a')
  expect(await state(ctx.page)).toEqual({ audible: ['d8.mp4', 'd12.mp4', 'clip6.webm'], bordered: [] })
  await frame(ctx.page, 1).click()
  await ctx.page.keyboard.press('A')
  expect((await state(ctx.page)).audible).toHaveLength(3)
})

test('mute (button and M) silences everything but preserves the set', async () => {
  await load(ctx.page, CLIPS)
  const mute = ctx.page.locator('#btn-mute')
  await frame(ctx.page, 1).click()
  await mute.click()
  await expect(mute).toHaveText('🔇')
  await expect(mute).toHaveClass(/active/)
  expect(await state(ctx.page)).toEqual({ audible: [], bordered: ['d12.mp4'] })
  expect((await tiles(ctx.page)).every((t) => has(t, 'muted-global'))).toBe(true)
  // Soloing while muted changes the set but stays silent.
  await frame(ctx.page, 0).click()
  expect(await state(ctx.page)).toEqual({ audible: [], bordered: ['d8.mp4'] })

  await mute.blur()
  await ctx.page.keyboard.press('m')
  await expect(mute).toHaveText('🔊')
  await expect(mute).not.toHaveClass(/active/)
  expect(await state(ctx.page)).toEqual({ audible: ['d8.mp4'], bordered: ['d8.mp4'] })
  expect((await tiles(ctx.page)).some((t) => has(t, 'muted-global'))).toBe(false)
  await ctx.page.keyboard.press('M')
  await expect(mute).toHaveText('🔇')
})

test('All sound shows dimmed while globally muted', async () => {
  await load(ctx.page, CLIPS)
  const all = ctx.page.locator('#btn-all')
  await ctx.page.keyboard.press('m')
  await expect(all).toHaveClass(/active-dim/)
  await expect(all).not.toHaveClass(/\bactive\b(?!-)/)
  await ctx.page.keyboard.press('m')
  await expect(all).toHaveClass(/\bactive\b(?!-)/)
  await expect(all).not.toHaveClass(/active-dim/)
})

test('removing the only audible video brings everyone back', async () => {
  await load(ctx.page, CLIPS)
  await frame(ctx.page, 1).click()
  await ctx.page.evaluate(() => window.mm.removeTile(window.mm.tiles[1]))
  expect(await state(ctx.page)).toEqual({ audible: ['d8.mp4', 'clip6.webm'], bordered: [] })
})
