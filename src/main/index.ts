import { app, BrowserWindow, dialog, ipcMain, screen, type Rectangle } from 'electron'
import { createReadStream, promises as fs } from 'fs'
import { pipeline } from 'stream'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { randomBytes } from 'crypto'
import { join, extname, dirname } from 'path'
import icon from '../../build/icon.png?asset'

const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm', '.ogg', '.ogv', '.mov', '.mkv'])

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg'
}

// --- loopback media servers ---
// Videos are served over 127.0.0.1 HTTP rather than a custom protocol:
// Chromium's media stack only treats http(s) resources as range-seekable, and
// files with a trailing moov atom need a seek to the file tail before they can
// even be demuxed (custom-scheme responses get aborted — electron#38749).
// Each file gets its OWN server on a dedicated port: Chromium caps HTTP/1.1 at
// 6 concurrent connections per origin, so a single shared port starves every
// video past the sixth (black tiles on load, mid-playback freezes). A port per
// file gives each video a private connection pool. Only explicitly registered
// files are served, via unguessable tokens.
//
// Range responses are also capped at MAX_RESPONSE_BYTES. A media element asks
// for `bytes=N-` (to end of file) and, once its buffer is full, just stops
// reading, so an uncapped response stays in flight for as long as the video
// plays. Chromium's network scheduler allows only 10 low-priority (media)
// requests in flight per page across ALL origins, so with 11+ videos one of
// them could wait 15-30 s for a slot to free up — a frozen tile after every
// seek. Chromium carries on past a short 206 by itself (it re-requests from
// where the body ended), so small responses keep slots turning over.
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

interface MediaEntry {
  port: number
  token: string
}

const mediaEntries = new Map<string, MediaEntry>()

async function entryFor(filePath: string): Promise<MediaEntry> {
  const existing = mediaEntries.get(filePath)
  if (existing) return existing
  const token = randomBytes(12).toString('hex')
  const server = createServer((req, res) => {
    if (decodeURIComponent((req.url ?? '').replace(/^\//, '')) !== token) {
      res.writeHead(404)
      res.end()
      return
    }
    serveFile(filePath, req, res).catch(() => {
      try {
        res.writeHead(500)
        res.end()
      } catch {
        // headers already sent
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const entry = { port: (server.address() as AddressInfo).port, token }
  mediaEntries.set(filePath, entry)
  return entry
}

async function serveFile(
  filePath: string,
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse
): Promise<void> {
  try {
    const total = (await fs.stat(filePath)).size
    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      let start = m && m[1] ? parseInt(m[1], 10) : NaN
      let end = m && m[2] ? parseInt(m[2], 10) : NaN
      if (Number.isNaN(start)) {
        // suffix range: last N bytes
        start = Math.max(0, total - end)
        end = total - 1
      } else if (Number.isNaN(end)) {
        end = total - 1
      }
      end = Math.min(end, total - 1)
      if (start >= total || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` })
        res.end()
        return
      }
      end = Math.min(end, start + MAX_RESPONSE_BYTES - 1)
      res.writeHead(206, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': end - start + 1
      })
      // pipeline (unlike .pipe) destroys both streams on error or client
      // abort — media elements abort range requests constantly, and leaked
      // read streams eventually wedge the server mid-response.
      pipeline(createReadStream(filePath, { start, end }), res, () => {})
    } else {
      res.writeHead(200, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Length': total
      })
      pipeline(createReadStream(filePath), res, () => {})
    }
  } catch {
    res.writeHead(500)
    res.end()
  }
}

// --- window state persistence ---

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
}

const stateFile = () => join(app.getPath('userData'), 'window-state.json')

/** True when a window's top-left corner lands on a connected display. */
function onScreen(x: number, y: number): boolean {
  return screen.getAllDisplays().some((d) => {
    const b = d.workArea
    return x >= b.x - 8 && y >= b.y - 8 && x < b.x + b.width && y < b.y + b.height
  })
}

async function loadWindowState(): Promise<WindowState> {
  const fallback: WindowState = { width: 1280, height: 800 }
  try {
    const raw = (await fs.readFile(stateFile(), 'utf8')).replace(/^\uFEFF/, '')
    const s = JSON.parse(raw) as WindowState
    if (typeof s.width !== 'number' || typeof s.height !== 'number') return fallback
    if (typeof s.x === 'number' && typeof s.y === 'number') {
      if (!onScreen(s.x, s.y)) {
        delete s.x
        delete s.y
      }
    }
    return s
  } catch {
    return fallback
  }
}

// --- settings persistence ---

interface Settings {
  /** Folder of the last file picked via the Add-videos dialog; seeds the next dialog. */
  lastFolder?: string
  /** Normal bounds of the last float window closed; the next float opens there. */
  floatBounds?: Rectangle
}

const settingsFile = () => join(app.getPath('userData'), 'settings.json')

let settings: Settings = {}

async function loadSettings(): Promise<Settings> {
  try {
    const raw = (await fs.readFile(settingsFile(), 'utf8')).replace(/^\uFEFF/, '')
    const s = JSON.parse(raw) as Settings
    const out: Settings = {}
    if (typeof s.lastFolder === 'string') out.lastFolder = s.lastFolder
    const b = s.floatBounds
    if (b && [b.x, b.y, b.width, b.height].every((n) => typeof n === 'number')) out.floatBounds = b
    return out
  } catch {
    // absent on first run, or unreadable/corrupt — start fresh
    return {}
  }
}

function saveSettings(): void {
  fs.writeFile(settingsFile(), JSON.stringify(settings)).catch(() => {
    // best effort
  })
}

// --- float windows ---
// A floated video lives in a same-origin window.open child of the main window
// (see src/renderer/float.ts). Only windows named mm-float-<n> are allowed, and
// they are tracked by that name so the renderer can full-screen them.

const FLOAT_NAME = /^mm-float-\d+$/
/** Offset applied while a spot is already taken by another open float. */
const FLOAT_CASCADE = 32

const floats = new Map<string, BrowserWindow>()

/**
 * Where a new float opens: the last float's bounds if still on screen, else
 * centred on a display other than the main window's, else beside the main
 * window. Cascades off any open float sitting on exactly the same spot.
 */
function floatBounds(main: BrowserWindow, width: number, height: number): Rectangle {
  let b: Rectangle
  const saved = settings.floatBounds
  if (saved && onScreen(saved.x, saved.y)) {
    b = { ...saved }
  } else {
    const mainBounds = main.getBounds()
    const home = screen.getDisplayMatching(mainBounds)
    const other = screen.getAllDisplays().find((d) => d.id !== home.id)
    const area = (other ?? home).workArea
    width = Math.min(width, area.width)
    height = Math.min(height, area.height)
    if (other) {
      b = { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height }
    } else {
      const x = Math.min(mainBounds.x + mainBounds.width - Math.round(width / 2), area.x + area.width - width)
      b = { x: Math.max(area.x, x), y: Math.max(area.y, mainBounds.y + FLOAT_CASCADE), width, height }
    }
  }
  const taken = (): boolean =>
    [...floats.values()].some((f) => {
      const o = f.getNormalBounds()
      return o.x === b.x && o.y === b.y
    })
  while (taken()) {
    b.x += FLOAT_CASCADE
    b.y += FLOAT_CASCADE
  }
  return b
}

async function expandPaths(paths: string[]): Promise<string[]> {
  const out: string[] = []
  for (const p of paths) {
    try {
      const stat = await fs.stat(p)
      if (stat.isDirectory()) {
        for (const entry of await fs.readdir(p)) {
          if (VIDEO_EXTS.has(extname(entry).toLowerCase())) out.push(join(p, entry))
        }
      } else if (VIDEO_EXTS.has(extname(p).toLowerCase())) {
        out.push(p)
      }
    } catch {
      // unreadable path — skip
    }
  }
  return out
}

async function createWindow(): Promise<void> {
  const state = await loadWindowState()
  settings = await loadSettings()
  const win = new BrowserWindow({
    ...state,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: '#101014',
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  win.on('close', () => {
    // Floats have no controls of their own; they go with the main window.
    for (const f of floats.values()) f.close()
    const b = win.getNormalBounds()
    try {
      require('fs').writeFileSync(stateFile(), JSON.stringify(b))
    } catch {
      // best effort
    }
  })

  // --- full screen ---
  // F11 is already bound to the default menu's Toggle Full Screen accelerator,
  // so the renderer must NOT toggle on F11 as well (it would cancel itself out).
  // It only listens for the resulting state and hides its own toolbar to match.
  win.on('enter-full-screen', () => win.webContents.send('full-screen', true))
  win.on('leave-full-screen', () => win.webContents.send('full-screen', false))

  ipcMain.handle('set-full-screen', (_e, on: boolean) => win.setFullScreen(on))
  ipcMain.handle('toggle-full-screen', () => win.setFullScreen(!win.isFullScreen()))

  win.webContents.setWindowOpenHandler(({ frameName, features }) => {
    if (!FLOAT_NAME.test(frameName)) return { action: 'deny' }
    const size = (key: string, fallback: number): number =>
      parseInt(new RegExp(`${key}=(\\d+)`).exec(features)?.[1] ?? '', 10) || fallback
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        ...floatBounds(win, size('width', 960), size('height', 540)),
        minWidth: 160,
        minHeight: 90,
        backgroundColor: '#000000',
        autoHideMenuBar: true
      }
    }
  })

  win.webContents.on('did-create-window', (child, { frameName }) => {
    floats.set(frameName, child)
    // Tracked as it changes rather than read on 'close', which not every way
    // of tearing a window down emits.
    let bounds = child.getNormalBounds()
    const track = (): void => {
      bounds = child.getNormalBounds()
    }
    child.on('move', track)
    child.on('resize', track)
    child.on('closed', () => {
      floats.delete(frameName)
      settings.floatBounds = bounds
      saveSettings()
    })
  })

  ipcMain.handle('float-full-screen', (_e, name: string, on: boolean) => floats.get(name)?.setFullScreen(on))

  ipcMain.handle('open-files', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'm4v', 'webm', 'ogg', 'ogv', 'mov', 'mkv'] }],
      ...(settings.lastFolder ? { defaultPath: settings.lastFolder } : {})
    })
    if (result.canceled || !result.filePaths.length) return []
    settings.lastFolder = dirname(result.filePaths[0])
    saveSettings()
    return result.filePaths
  })

  ipcMain.handle('expand-paths', (_e, paths: string[]) => expandPaths(paths))

  ipcMain.handle('media-urls', (_e, paths: string[]) =>
    Promise.all(
      paths.map(async (p) => {
        const { port, token } = await entryFor(p)
        return `http://127.0.0.1:${port}/${token}`
      })
    )
  )

  // Dev/test helpers: MM_AUTOLOAD=<dir-or-files;...> loads videos on startup,
  // MM_AUTOPLAY=1 starts playback 1.5s later, MM_SHOT=<delayMs>:<pngPath>[;...]
  // captures screenshots, and MM_REPORT=<delayMs>:<jsonPath> dumps per-tile
  // decoder state for automated verification.
  win.webContents.on('did-finish-load', async () => {
    if (process.env.MM_AUTOLOAD) {
      const paths = await expandPaths(process.env.MM_AUTOLOAD.split(';'))
      win.webContents.send('autoload', paths)
      if (process.env.MM_AUTOPLAY) {
        setTimeout(() => win.webContents.executeJavaScript('window.mm.timeline.play()'), 1500)
      }
    }
    if (process.env.MM_EVAL) {
      const [delay, ...rest] = process.env.MM_EVAL.split(':')
      setTimeout(() => win.webContents.executeJavaScript(rest.join(':')), parseInt(delay, 10))
    }
    if (process.env.MM_REPORT) {
      const [delay, ...rest] = process.env.MM_REPORT.split(':')
      const outPath = rest.join(':')
      setTimeout(async () => {
        const report = await win.webContents.executeJavaScript(
          `JSON.stringify({ extra: window.__mmExtra ?? null, tiles: window.mm.tiles.map(t => ({
             name: t.name,
             error: t.video.error ? { code: t.video.error.code, message: t.video.error.message } : null,
             readyState: t.video.readyState,
             networkState: t.video.networkState,
             buffered: Array.from({ length: t.video.buffered.length }, (_, i) =>
               [t.video.buffered.start(i), t.video.buffered.end(i)].map(x => Math.round(x * 10) / 10)),
             videoWidth: t.video.videoWidth,
             videoHeight: t.video.videoHeight,
             duration: t.video.duration,
             currentTime: t.video.currentTime,
             videoDecodedBytes: t.video.webkitVideoDecodedByteCount ?? null,
             audioDecodedBytes: t.video.webkitAudioDecodedByteCount ?? null
           })) }, null, 2)`
        )
        await fs.writeFile(outPath, report)
      }, parseInt(delay, 10))
    }
    for (const spec of (process.env.MM_SHOT ?? '').split(';').filter(Boolean)) {
      const [delay, ...rest] = spec.split(':')
      const outPath = rest.join(':')
      setTimeout(async () => {
        const img = await win.webContents.capturePage()
        await fs.writeFile(outPath, img.toPNG())
      }, parseInt(delay, 10))
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Test helper: MM_USER_DATA=<dir> isolates window state and settings from the
// real profile. Must run before 'ready'.
if (process.env.MM_USER_DATA) app.setPath('userData', process.env.MM_USER_DATA)

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => app.quit())
