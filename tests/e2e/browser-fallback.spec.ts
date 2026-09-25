import { join } from 'path'
import { ROOT, closeApp, expect, fx, launchApp, test } from './helpers'

// The renderer without Electron's preload (window.api absent) is the plain
// browser path: <input type=file> + blob URLs. Rather than download a separate
// browser, open the built renderer in a second, preload-less Electron window —
// same Chromium, same code path.
test('without window.api, files from the file input load as blob URLs and play', async () => {
  const ctx = await launchApp()
  const pagePromise = ctx.app.waitForEvent('window')
  await ctx.app.evaluate(({ BrowserWindow }, file) => {
    const w = new BrowserWindow({ width: 1000, height: 700 })
    void w.loadFile(file)
  }, join(ROOT, 'out/renderer/index.html'))
  const page = await pagePromise
  await page.waitForFunction(() => !!window.mm)
  expect(await page.evaluate(() => 'api' in window)).toBe(false)

  // Non-video files are filtered out, as in a drag-drop of a mixed selection.
  await page.locator('#file-input').setInputFiles([fx('d3.mp4'), fx('clip6.webm'), fx('folder/notes.txt')])
  await expect(page.locator('.tile')).toHaveCount(2)
  const srcs = await page.evaluate(() => window.mm.tiles.map((t) => t.video.src))
  for (const s of srcs) expect(s).toMatch(/^blob:/)

  await page.waitForFunction(() => window.mm.tiles.every((t) => t.video.readyState >= 3))
  await page.keyboard.press('Space')
  await page.waitForFunction(() => window.mm.timeline.currentTime > 1)
  const times = await page.evaluate(() => window.mm.tiles.map((t) => t.video.currentTime))
  for (const t of times) expect(t).toBeGreaterThan(0.8)

  // Removing a blob-backed tile revokes its URL.
  const revoked = await page.evaluate(async () => {
    const t = window.mm.tiles[0]
    const url = t.video.src
    window.mm.removeTile(t)
    try {
      await fetch(url)
      return false
    } catch {
      return true
    }
  })
  expect(revoked).toBe(true)
  await closeApp(ctx)
})
