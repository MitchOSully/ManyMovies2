import { expect, load, test, useApp } from './helpers'

const ctx = useApp()

test('Add and Clear are icon-only, with tooltips', async () => {
  await expect(ctx.page.locator('#btn-add')).toHaveAttribute('data-icon', 'plus')
  await expect(ctx.page.locator('#btn-add')).toHaveAttribute('title', 'Add videos')
  await expect(ctx.page.locator('#btn-clear')).toHaveAttribute('data-icon', 'x')
  await expect(ctx.page.locator('#btn-clear')).toHaveAttribute('title', 'Remove all videos')
})

test('Add is green and Clear is red', async () => {
  await load(ctx.page, ['d8.mp4'])
  await expect(ctx.page.locator('#btn-add')).toHaveCSS('color', 'rgb(74, 222, 128)')
  await expect(ctx.page.locator('#btn-clear')).toHaveCSS('color', 'rgb(248, 113, 113)')
  await expect(ctx.page.locator('#btn-add')).toHaveCSS('background-color', 'rgb(28, 58, 40)')
  await expect(ctx.page.locator('#btn-clear')).toHaveCSS('background-color', 'rgb(62, 34, 36)')
})

test('every icon renders as an inline SVG, with no leftover text glyphs', async () => {
  await load(ctx.page, ['d8.mp4'])
  const icons = await ctx.page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-icon]')].map((el) => {
      const svg = el.querySelector('svg')
      const r = svg?.getBoundingClientRect()
      return { icon: el.dataset.icon, svgs: el.querySelectorAll('svg').length, text: el.textContent!.trim(), w: r?.width ?? 0 }
    })
  )
  // Toolbar (9) + empty-state hint (1) + one tile's strip and frame buttons (6).
  expect(icons).toHaveLength(16)
  for (const i of icons) {
    expect(i.svgs, i.icon).toBe(1)
    expect(i.text, i.icon).toBe('')
  }
  // Toolbar icons are sized by the CSS, not the SVG's own 24px attributes.
  const add = (await ctx.page.locator('#btn-add svg').boundingBox())!
  expect(add.width).toBe(18)
})

test('icons follow state: play/pause, and full screen in and out', async () => {
  await load(ctx.page, ['d8.mp4'])
  const play = ctx.page.locator('#btn-play')
  const full = ctx.page.locator('#btn-full')
  await expect(play).toHaveAttribute('data-icon', 'play')
  await ctx.page.keyboard.press('Space')
  await expect(play).toHaveAttribute('data-icon', 'pause')
  await ctx.page.keyboard.press('Space')
  await expect(play).toHaveAttribute('data-icon', 'play')

  await expect(full).toHaveAttribute('data-icon', 'maximize')
  await full.click()
  await expect(full).toHaveAttribute('data-icon', 'minimize')
  await full.blur()
  await ctx.page.keyboard.press('Escape')
  await expect(full).toHaveAttribute('data-icon', 'maximize')
})

test('play/pause sits directly before the slider', async () => {
  const prev = await ctx.page.evaluate(() => document.getElementById('slider')!.previousElementSibling?.id)
  expect(prev).toBe('btn-play')
})

test('secondary controls start collapsed and toggle open and shut with › / ‹', async () => {
  const more = ctx.page.locator('#btn-more')
  const extras = ctx.page.locator('#extras')
  const hidden = ['#btn-back', '#btn-fwd', '#rate', '#btn-mute', '#btn-all', '#btn-cycle', '#cycle-interval', '#btn-titles']
  const sliderW = async (): Promise<number> => (await ctx.page.locator('#slider').boundingBox())!.width

  await expect(more).toHaveAttribute('data-icon', 'chevron-right')
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(extras).toHaveAttribute('inert')
  // Collapsed, the group is zero-width, so its controls have no visible box.
  for (const sel of hidden) await expect(ctx.page.locator(sel), sel).not.toBeInViewport()
  const collapsedW = await sliderW()

  await more.click()
  await expect(more).toHaveAttribute('data-icon', 'chevron-left')
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(extras).not.toHaveAttribute('inert')
  for (const sel of hidden) await expect(ctx.page.locator(sel), sel).toBeInViewport({ ratio: 1 })
  expect(await sliderW()).toBeLessThan(collapsedW - 200)

  await more.click()
  await expect(more).toHaveAttribute('data-icon', 'chevron-right')
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(extras).toHaveAttribute('inert')
  await expect.poll(sliderW).toBeCloseTo(collapsedW, 0)
})

test('collapsed, the toggle flags a non-default mute or speed', async () => {
  await load(ctx.page, ['d8.mp4'])
  const more = ctx.page.locator('#btn-more')
  await expect(more).not.toHaveClass(/active-dim/)
  await expect(more).toHaveAttribute('title', 'More controls')

  await ctx.page.keyboard.press('m')
  await expect(more).toHaveClass(/active-dim/)
  await expect(more).toHaveAttribute('title', 'More controls — muted')
  await ctx.page.keyboard.press('ArrowUp')
  await expect(more).toHaveAttribute('title', 'More controls — muted, 2×')

  // Open, the controls speak for themselves.
  await more.click()
  await expect(more).not.toHaveClass(/active-dim/)
  await expect(more).toHaveAttribute('title', 'Fewer controls')
  await more.click()
  await more.blur()
  await expect(more).toHaveClass(/active-dim/)

  await ctx.page.keyboard.press('m')
  await expect(more).toHaveAttribute('title', 'More controls — 2×')
  await ctx.page.keyboard.press('ArrowDown')
  await expect(more).not.toHaveClass(/active-dim/)
  await expect(more).toHaveAttribute('title', 'More controls')
})
