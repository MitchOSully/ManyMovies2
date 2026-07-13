import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron'
import { createReadStream, promises as fs } from 'fs'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { randomBytes } from 'crypto'
import { join, extname } from 'path'

const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm', '.ogg', '.ogv', '.mov'])

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg'
}

// --- loopback media server ---
// Videos are served over 127.0.0.1 HTTP rather than a custom protocol:
// Chromium's media stack only treats http(s) resources as range-seekable, and
// files with a trailing moov atom need a seek to the file tail before they can
// even be demuxed (custom-scheme responses get aborted — electron#38749).
// Only explicitly registered files are served, via unguessable tokens.

const tokenToPath = new Map<string, string>()
const pathToToken = new Map<string, string>()
let mediaPort = 0

function tokenFor(filePath: string): string {
  let token = pathToToken.get(filePath)
  if (!token) {
    token = randomBytes(12).toString('hex')
    pathToToken.set(filePath, token)
    tokenToPath.set(token, filePath)
  }
  return token
}

const mediaServer = createServer(async (req, res) => {
  try {
    const token = decodeURIComponent((req.url ?? '').replace(/^\//, ''))
    const filePath = tokenToPath.get(token)
    if (!filePath) {
      res.writeHead(404)
      res.end()
      return
    }
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
      res.writeHead(206, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': end - start + 1
      })
      createReadStream(filePath, { start, end }).pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Length': total
      })
      createReadStream(filePath).pipe(res)
    }
  } catch {
    res.writeHead(500)
    res.end()
  }
})

async function startMediaServer(): Promise<void> {
  await new Promise<void>((resolve) => mediaServer.listen(0, '127.0.0.1', resolve))
  mediaPort = (mediaServer.address() as AddressInfo).port
}

// --- window state persistence ---

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
}

const stateFile = () => join(app.getPath('userData'), 'window-state.json')

async function loadWindowState(): Promise<WindowState> {
  const fallback: WindowState = { width: 1280, height: 800 }
  try {
    const raw = (await fs.readFile(stateFile(), 'utf8')).replace(/^\uFEFF/, '')
    const s = JSON.parse(raw) as WindowState
    if (typeof s.width !== 'number' || typeof s.height !== 'number') return fallback
    if (typeof s.x === 'number' && typeof s.y === 'number') {
      const visible = screen.getAllDisplays().some((d) => {
        const b = d.workArea
        return s.x! >= b.x - 8 && s.y! >= b.y - 8 && s.x! < b.x + b.width && s.y! < b.y + b.height
      })
      if (!visible) {
        delete s.x
        delete s.y
      }
    }
    return s
  } catch {
    return fallback
  }
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
  const win = new BrowserWindow({
    ...state,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: '#101014',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  win.on('close', () => {
    const b = win.getNormalBounds()
    try {
      require('fs').writeFileSync(stateFile(), JSON.stringify(b))
    } catch {
      // best effort
    }
  })

  ipcMain.handle('open-files', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'm4v', 'webm', 'ogg', 'ogv', 'mov'] }]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('expand-paths', (_e, paths: string[]) => expandPaths(paths))

  ipcMain.handle('media-urls', (_e, paths: string[]) =>
    paths.map((p) => `http://127.0.0.1:${mediaPort}/${tokenFor(p)}`)
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
          `JSON.stringify(window.mm.tiles.map(t => ({
             name: t.name,
             error: t.video.error ? { code: t.video.error.code, message: t.video.error.message } : null,
             readyState: t.video.readyState,
             videoWidth: t.video.videoWidth,
             videoHeight: t.video.videoHeight,
             duration: t.video.duration,
             currentTime: t.video.currentTime,
             videoDecodedBytes: t.video.webkitVideoDecodedByteCount ?? null,
             audioDecodedBytes: t.video.webkitAudioDecodedByteCount ?? null
           })), null, 2)`
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

app.whenReady().then(async () => {
  await startMediaServer()
  createWindow()
})

app.on('window-all-closed', () => app.quit())
