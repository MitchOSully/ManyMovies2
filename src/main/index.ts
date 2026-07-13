import { app, BrowserWindow, dialog, ipcMain, protocol, screen } from 'electron'
import { createReadStream, promises as fs } from 'fs'
import { Readable } from 'stream'
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

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { stream: true, bypassCSP: true, supportFetchAPI: true } }
])

// --- media:// protocol: serves local video files with Range support (required for seeking) ---

async function serveMedia(req: Request): Promise<Response> {
  const filePath = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''))
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const total = stat.size
  const headers: Record<string, string> = {
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes'
  }
  const range = req.headers.get('range')
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    const start = m && m[1] ? parseInt(m[1], 10) : 0
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1
    if (Number.isNaN(start) || start >= total) return new Response(null, { status: 416 })
    end = Math.min(end, total - 1)
    headers['Content-Range'] = `bytes ${start}-${end}/${total}`
    headers['Content-Length'] = String(end - start + 1)
    const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
    return new Response(stream, { status: 206, headers })
  }
  headers['Content-Length'] = String(total)
  return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, { status: 200, headers })
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

  // Dev/test helpers: MM_AUTOLOAD=<dir-or-files;...> loads videos on startup,
  // MM_AUTOPLAY=1 starts playback 1.5s later, and MM_SHOT=<delayMs>:<pngPath>[;...]
  // captures screenshots for automated verification.
  win.webContents.on('did-finish-load', async () => {
    if (process.env.MM_AUTOLOAD) {
      const paths = await expandPaths(process.env.MM_AUTOLOAD.split(';'))
      win.webContents.send('autoload', paths)
      if (process.env.MM_AUTOPLAY) {
        setTimeout(() => win.webContents.executeJavaScript('window.mm.timeline.play()'), 1500)
      }
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

app.whenReady().then(() => {
  protocol.handle('media', serveMedia)
  createWindow()
})

app.on('window-all-closed', () => app.quit())
