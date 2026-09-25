import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { VideoSource, VideoTile } from '../../src/renderer/player'
import type { Timeline } from '../../src/renderer/timeline'
import type { AudioController } from '../../src/renderer/audio'
import { READY_MS } from './tolerances'

declare global {
  interface Window {
    /** Debug hook exposed at the bottom of src/renderer/main.ts. */
    mm: {
      addSources(sources: VideoSource[]): void
      removeTile(tile: VideoTile): void
      timeline: Timeline
      audio: AudioController
      tiles: VideoTile[]
      toggleTitles(): void
      toggleFullScreen(): void
    }
  }
}

export const ROOT = resolve(__dirname, '../..')
export const FIXTURES = join(ROOT, 'tests/fixtures/out')
export const fx = (name: string): string => join(FIXTURES, name)
export const MANY = Array.from({ length: 9 }, (_, i) => `many/m${i + 1}.mp4`)

export interface AppCtx {
  app: ElectronApplication
  page: Page
  userData: string
}

export interface LaunchOpts {
  /** Reuse an existing profile dir (relaunch tests); otherwise a fresh temp one. */
  userData?: string
  /** Seeded into window-state.json of a fresh profile; null = leave absent. */
  windowState?: object | string | null
  env?: Record<string, string>
}

export async function launchApp(opts: LaunchOpts = {}): Promise<AppCtx> {
  const userData = opts.userData ?? mkdtempSync(join(tmpdir(), 'mm-test-'))
  if (!opts.userData && opts.windowState !== null) {
    const s = opts.windowState ?? { width: 1280, height: 800 }
    writeFileSync(join(userData, 'window-state.json'), typeof s === 'string' ? s : JSON.stringify(s))
  }
  const env: Record<string, string> = { ...(process.env as Record<string, string>), MM_USER_DATA: userData, ...opts.env }
  // A leaked dev-server URL would load the live renderer instead of the build.
  delete env.ELECTRON_RENDERER_URL
  const app = await _electron.launch({ args: [ROOT], cwd: ROOT, env })
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.mm)
  return { app, page, userData }
}

export async function closeApp(ctx: AppCtx, { keepProfile = false } = {}): Promise<void> {
  await ctx.app.close()
  if (!keepProfile) rmSync(ctx.userData, { recursive: true, force: true })
}

/**
 * One app instance per spec file: launched once, reset to a clean slate before
 * every test, and dumped (screenshot + per-tile decoder state) on failure.
 */
export function useApp(opts: LaunchOpts = {}): AppCtx {
  const ctx = {} as AppCtx
  test.beforeAll(async () => {
    Object.assign(ctx, await launchApp(opts))
  })
  test.afterAll(async () => {
    if (ctx.app) await closeApp(ctx)
  })
  test.beforeEach(async () => {
    await resetApp(ctx)
  })
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus || !ctx.page) return
    try {
      const shot = testInfo.outputPath('failure.png')
      await ctx.page.screenshot({ path: shot })
      await testInfo.attach('screenshot', { path: shot, contentType: 'image/png' })
      const dump = testInfo.outputPath('tiles.json')
      writeFileSync(dump, JSON.stringify(await decoderReport(ctx.page), null, 2))
      await testInfo.attach('tiles', { path: dump, contentType: 'application/json' })
    } catch {
      // app may already be gone
    }
  })
  return ctx
}

/** Back to a fresh-launch state without paying for a relaunch. */
export async function resetApp(ctx: AppCtx): Promise<void> {
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win.isFullScreen()) win.setFullScreen(false)
    if (win.isMinimized()) win.restore()
    win.setSize(1280, 800)
  })
  await ctx.page.waitForFunction(() => !document.body.classList.contains('fullscreen'))
  await ctx.page.evaluate(() => {
    const mm = window.mm
    mm.timeline.pause()
    for (const t of [...mm.tiles]) mm.removeTile(t)
    mm.timeline.setRate(1)
    ;(document.getElementById('rate') as HTMLSelectElement).value = '1'
    if (mm.audio.muted) document.getElementById('btn-mute')!.click()
    mm.audio.allSound()
    if (!document.getElementById('tiles')!.classList.contains('no-strips')) mm.toggleTitles()
    ;(document.activeElement as HTMLElement | null)?.blur()
  })
  await ctx.page.mouse.move(640, 300)
}

export const basename = (p: string): string => p.split(/[\\/]/).pop()!

/**
 * Adds fixtures exactly the way the app's own addPaths does (loopback URLs from
 * the main process), then waits for each tile to be playable or to have failed.
 */
export async function load(page: Page, names: string[], { wait = true } = {}): Promise<void> {
  await page.evaluate(async (paths) => {
    const urls = await window.api!.mediaUrls(paths)
    window.mm.addSources(paths.map((p, i) => ({ url: urls[i], name: p.split(/[\\/]/).pop()! })))
  }, names.map(fx))
  if (wait) await waitReady(page)
}

export async function waitReady(page: Page, timeout = READY_MS): Promise<void> {
  await page.waitForFunction(
    () => window.mm.tiles.every((t) => t.video.error || t.video.readyState >= 3),
    undefined,
    { timeout }
  )
}

export interface TileState {
  name: string
  classes: string[]
  /** Visual box (includes any in-flight FLIP transform). */
  rect: { x: number; y: number; w: number; h: number }
  /** Layout width, ignoring transforms. */
  layoutW: number
  currentTime: number
  duration: number
  paused: boolean
  ended: boolean
  rate: number
  muted: boolean
  volume: number
  readyState: number
  error: number | null
  finished: boolean
  transform: string
}

export function tiles(page: Page): Promise<TileState[]> {
  return page.evaluate(() =>
    window.mm.tiles.map((t) => {
      const r = t.el.getBoundingClientRect()
      return {
        name: t.name,
        classes: [...t.el.classList],
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        layoutW: t.el.offsetWidth,
        currentTime: t.video.currentTime,
        duration: t.duration,
        paused: t.video.paused,
        ended: t.video.ended,
        rate: t.video.playbackRate,
        muted: t.video.muted,
        volume: t.video.volume,
        readyState: t.video.readyState,
        error: t.video.error?.code ?? null,
        finished: t.finished,
        transform: t.el.style.transform
      }
    })
  )
}

export const has = (t: TileState, cls: string): boolean => t.classes.includes(cls)
export const byName = (all: TileState[], name: string): TileState => all.find((t) => t.name === basename(name))!

export const time = (page: Page): Promise<number> => page.evaluate(() => window.mm.timeline.currentTime)
export const playing = (page: Page): Promise<boolean> => page.evaluate(() => window.mm.timeline.playing)

/** Polls until the global timeline reaches `t` seconds. */
export async function waitTime(page: Page, t: number, timeout = 20_000): Promise<void> {
  await page.waitForFunction((t) => window.mm.timeline.currentTime >= t, t, { timeout })
}

/** Spread of currentTime across tiles still playing (not finished, decodable). */
export async function syncSpread(page: Page): Promise<number> {
  return page.evaluate(() => {
    const ts = window.mm.tiles.filter((t) => !t.finished && t.duration > 0).map((t) => t.video.currentTime)
    return ts.length ? Math.max(...ts) - Math.min(...ts) : 0
  })
}

export function decoderReport(page: Page): Promise<unknown> {
  return page.evaluate(() =>
    window.mm.tiles.map((t) => {
      const v = t.video as HTMLVideoElement & { webkitVideoDecodedByteCount?: number; webkitAudioDecodedByteCount?: number }
      return {
        name: t.name,
        classes: t.el.className,
        error: v.error ? { code: v.error.code, message: v.error.message } : null,
        readyState: v.readyState,
        networkState: v.networkState,
        paused: v.paused,
        buffered: Array.from({ length: v.buffered.length }, (_, i) => [v.buffered.start(i), v.buffered.end(i)]),
        duration: v.duration,
        currentTime: v.currentTime,
        videoDecodedBytes: v.webkitVideoDecodedByteCount ?? null,
        audioDecodedBytes: v.webkitAudioDecodedByteCount ?? null
      }
    })
  )
}

export async function stageRect(page: Page): Promise<{ w: number; h: number; x: number; y: number }> {
  return page.evaluate(() => {
    const r = document.getElementById('stage')!.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
}

/** Centre of a tile's video frame, for real clicks. */
export async function frameCenter(page: Page, index: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.tile').nth(index).locator('.frame').boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export { expect, test }
