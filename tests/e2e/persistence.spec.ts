import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { closeApp, expect, fx, launchApp, test, tiles, type AppCtx } from './helpers'

type Bounds = { x: number; y: number; width: number; height: number }

const bounds = (ctx: AppCtx): Promise<Bounds> =>
  ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds())

test('window bounds are saved on close and restored on relaunch', async () => {
  const first = await launchApp({ windowState: { x: 120, y: 90, width: 1000, height: 700 } })
  expect(await bounds(first)).toMatchObject({ x: 120, y: 90, width: 1000, height: 700 })
  await first.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ x: 160, y: 110, width: 1100, height: 720 })
  )
  await closeApp(first, { keepProfile: true })
  const saved = JSON.parse(readFileSync(join(first.userData, 'window-state.json'), 'utf8'))
  expect(saved).toMatchObject({ x: 160, y: 110, width: 1100, height: 720 })

  const second = await launchApp({ userData: first.userData })
  expect(await bounds(second)).toMatchObject({ x: 160, y: 110, width: 1100, height: 720 })
  await closeApp(second)
})

test('a saved position that is off every screen is dropped, keeping the size', async () => {
  const ctx = await launchApp({ windowState: { x: -30000, y: -30000, width: 900, height: 600 } })
  const b = await bounds(ctx)
  expect(b).toMatchObject({ width: 900, height: 600 })
  const onScreen = await ctx.app.evaluate(
    ({ screen }, b) =>
      screen.getAllDisplays().some((d) => {
        const a = d.workArea
        return b.x >= a.x - 8 && b.y >= a.y - 8 && b.x < a.x + a.width && b.y < a.y + a.height
      }),
    b
  )
  expect(onScreen).toBe(true)
  await closeApp(ctx)
})

const stateCases: [string, string | null, { width: number; height: number }][] = [
  ['corrupt', '{ not json', { width: 1280, height: 800 }],
  ['missing', null, { width: 1280, height: 800 }],
  ['BOM-prefixed', '﻿{"width":1024,"height":640}', { width: 1024, height: 640 }],
  ['sizeless', '{"x":10,"y":10}', { width: 1280, height: 800 }]
]
for (const [label, content, want] of stateCases) {
  test(`a ${label} window-state file is tolerated`, async () => {
    const ctx = await launchApp({ windowState: content })
    expect(await bounds(ctx)).toMatchObject(want)
    await closeApp(ctx)
  })
}

/** Stand in for the native dialog (which can't be automated): record the request, answer with `picks`. */
async function stubDialog(ctx: AppCtx, picks: string[] | null): Promise<void> {
  await ctx.app.evaluate(({ dialog }, picks) => {
    const g = globalThis as unknown as { __dialogOpts: unknown[] }
    g.__dialogOpts = []
    dialog.showOpenDialog = (async (_win: unknown, opts: unknown) => {
      g.__dialogOpts.push(opts)
      return picks ? { canceled: false, filePaths: picks } : { canceled: true, filePaths: [] }
    }) as unknown as typeof dialog.showOpenDialog
  }, picks)
}

test('＋ Add videos: the picker opens in the last folder, adds the picks, and remembers the new folder', async () => {
  const seed = await launchApp()
  const seeded = dirname(fx('folder/a.mp4'))
  await closeApp(seed, { keepProfile: true })
  writeFileSync(join(seed.userData, 'settings.json'), '﻿' + JSON.stringify({ lastFolder: seeded }))

  const ctx = await launchApp({ userData: seed.userData })
  await stubDialog(ctx, [fx('d3.mp4'), fx('d5.mp4')])
  await ctx.page.locator('#btn-add').click()
  await expect(ctx.page.locator('.tile')).toHaveCount(2)
  expect((await tiles(ctx.page)).map((t) => t.name)).toEqual(['d3.mp4', 'd5.mp4'])

  const [opts] = (await ctx.app.evaluate(
    () => (globalThis as unknown as { __dialogOpts: unknown[] }).__dialogOpts
  )) as { defaultPath?: string; properties: string[]; filters: { extensions: string[] }[] }[]
  expect(opts.defaultPath).toBe(seeded)
  expect(opts.properties).toEqual(expect.arrayContaining(['openFile', 'multiSelections']))
  expect(opts.filters[0].extensions.sort()).toEqual(['m4v', 'mkv', 'mov', 'mp4', 'ogg', 'ogv', 'webm'])

  const settingsPath = join(ctx.userData, 'settings.json')
  await expect
    .poll(() => existsSync(settingsPath) && JSON.parse(readFileSync(settingsPath, 'utf8').replace(/^﻿/, '')).lastFolder)
    .toBe(dirname(fx('d3.mp4')))
  await closeApp(ctx)
})

test('a cancelled picker adds nothing and leaves the settings alone', async () => {
  const ctx = await launchApp()
  await stubDialog(ctx, null)
  await ctx.page.locator('#btn-add').click()
  await ctx.page.waitForTimeout(300)
  await expect(ctx.page.locator('.tile')).toHaveCount(0)
  await expect(ctx.page.locator('#empty')).toBeVisible()
  expect(existsSync(join(ctx.userData, 'settings.json'))).toBe(false)
  await closeApp(ctx)
})
