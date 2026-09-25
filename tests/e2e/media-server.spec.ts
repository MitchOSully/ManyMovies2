import { statSync } from 'fs'
import { SEEK, SEEK_RECOVERY_MS, SETTLE_MS, SYNC_SPREAD } from './tolerances'
import { LONG, MANY, decoderReport, expect, fx, load, syncSpread, test, tiles, time, useApp, waitTime } from './helpers'

const ctx = useApp()

const urlFor = (path: string): Promise<string> =>
  ctx.page.evaluate(async (p) => (await window.api!.mediaUrls([p]))[0], path)

test('more than six videos all load, play and stay in sync (per-file ports)', async () => {
  await load(ctx.page, MANY)
  const ports = new Set((await ctx.page.evaluate(() => window.mm.tiles.map((t) => new URL(t.video.src).port))))
  expect(ports.size).toBe(MANY.length)
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 3)
  await ctx.page.waitForTimeout(SETTLE_MS)
  const all = await tiles(ctx.page)
  for (const t of all) {
    expect(t.readyState, t.name).toBeGreaterThanOrEqual(3)
    expect(t.paused, t.name).toBe(false)
    expect(t.currentTime, t.name).toBeGreaterThan(3)
  }
  expect(await syncSpread(ctx.page)).toBeLessThan(SYNC_SPREAD)
  const report = (await decoderReport(ctx.page)) as { videoDecodedBytes: number }[]
  for (const r of report) expect(r.videoDecodedBytes).toBeGreaterThan(0)
})

test('more than ten long videos all resume promptly after a seek (per-page request budget)', async () => {
  // Every playing video holds a download open; Chromium allows 10 per page.
  // Uncapped responses left the 11th tile frozen for 15-30 s after a seek.
  await load(ctx.page, LONG)
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 2)
  for (let i = 0; i < 3; i++) await ctx.page.keyboard.press('ArrowRight')
  const target = await time(ctx.page)
  expect(target).toBeGreaterThan(30)
  await expect
    .poll(
      async () =>
        (await tiles(ctx.page))
          .filter((t) => t.readyState < 3 || t.paused || t.currentTime < target + 0.5)
          .map((t) => t.name),
      { timeout: SEEK_RECOVERY_MS, intervals: [100] }
    )
    .toEqual([])
  await ctx.page.waitForTimeout(SETTLE_MS)
  expect(await syncSpread(ctx.page)).toBeLessThan(SYNC_SPREAD)
})

test('open-ended ranges are answered in bounded chunks', async () => {
  const path = fx(LONG[0])
  const total = statSync(path).size
  const cap = 2 * 1024 * 1024
  expect(total).toBeGreaterThan(cap * 2)
  const url = await urlFor(path)
  const r = await fetch(url, { headers: { Range: 'bytes=1000-' } })
  expect(r.status).toBe(206)
  expect(r.headers.get('content-range')).toBe(`bytes 1000-${1000 + cap - 1}/${total}`)
  expect((await r.arrayBuffer()).byteLength).toBe(cap)
})

test('a file with its moov atom at the end loads, seeks and plays', async () => {
  await load(ctx.page, ['endmoov8.mp4'])
  const [t] = await tiles(ctx.page)
  expect(t.error).toBeNull()
  expect(t.duration).toBeCloseTo(8, 0)
  await ctx.page.evaluate(() => window.mm.timeline.seek(6))
  await expect.poll(async () => Math.abs((await tiles(ctx.page))[0].currentTime - 6)).toBeLessThan(SEEK)
  await ctx.page.keyboard.press('Space')
  await waitTime(ctx.page, 6.5)
  expect(await time(ctx.page)).toBeLessThan(8)
})

test('the same path maps to the same URL, different paths to different servers', async () => {
  const a1 = await urlFor(fx('d3.mp4'))
  const a2 = await urlFor(fx('d3.mp4'))
  const b = await urlFor(fx('d5.mp4'))
  expect(a1).toBe(a2)
  expect(new URL(a1).hostname).toBe('127.0.0.1')
  expect(new URL(a1).port).not.toBe(new URL(b).port)
})

test('serves byte ranges correctly', async () => {
  const path = fx('d3.mp4')
  const total = statSync(path).size
  const url = await urlFor(path)

  const full = await fetch(url)
  expect(full.status).toBe(200)
  expect(full.headers.get('accept-ranges')).toBe('bytes')
  expect(full.headers.get('content-type')).toBe('video/mp4')
  expect(Number(full.headers.get('content-length'))).toBe(total)
  expect((await full.arrayBuffer()).byteLength).toBe(total)

  const head = await fetch(url, { headers: { Range: 'bytes=0-99' } })
  expect(head.status).toBe(206)
  expect(head.headers.get('content-range')).toBe(`bytes 0-99/${total}`)
  expect((await head.arrayBuffer()).byteLength).toBe(100)

  const open = await fetch(url, { headers: { Range: `bytes=${total - 10}-` } })
  expect(open.status).toBe(206)
  expect(open.headers.get('content-range')).toBe(`bytes ${total - 10}-${total - 1}/${total}`)
  expect((await open.arrayBuffer()).byteLength).toBe(10)

  const suffix = await fetch(url, { headers: { Range: 'bytes=-100' } })
  expect(suffix.status).toBe(206)
  expect(suffix.headers.get('content-range')).toBe(`bytes ${total - 100}-${total - 1}/${total}`)
  expect((await suffix.arrayBuffer()).byteLength).toBe(100)

  const clamped = await fetch(url, { headers: { Range: `bytes=${total - 5}-${total + 1000}` } })
  expect(clamped.status).toBe(206)
  expect((await clamped.arrayBuffer()).byteLength).toBe(5)

  const past = await fetch(url, { headers: { Range: `bytes=${total}-` } })
  expect(past.status).toBe(416)
  expect(past.headers.get('content-range')).toBe(`bytes */${total}`)
  await past.arrayBuffer()
})

test('only the registered token is served', async () => {
  const url = new URL(await urlFor(fx('d3.mp4')))
  for (const bad of ['/', '/nope', `/${url.pathname.slice(1)}x`, '/../d3.mp4']) {
    const r = await fetch(`${url.origin}${bad}`)
    expect(r.status, bad).toBe(404)
    await r.arrayBuffer()
  }
})

test('mime types follow the extension', async () => {
  const cases: [string, string][] = [
    ['clip6.webm', 'video/webm'],
    ['clip6.mkv', 'video/x-matroska'],
    ['clip6.mov', 'video/quicktime'],
    ['folder/C.MKV', 'video/x-matroska']
  ]
  for (const [name, type] of cases) {
    const r = await fetch(await urlFor(fx(name)), { headers: { Range: 'bytes=0-0' } })
    expect(r.headers.get('content-type'), name).toBe(type)
    await r.arrayBuffer()
  }
})
