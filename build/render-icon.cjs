// Regenerates build/<name>.png + build/<name>.ico from build/<name>.svg.
// Run: npx electron build/render-icon.cjs [name]  (default: icon → icon.svg/.png/.ico)
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const name = process.argv[2] ?? 'icon'
const svg = fs.readFileSync(path.join(__dirname, name + '.svg'), 'utf8')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  const pngs = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))}
    await img.decode()
    const out = {}
    for (const s of ${JSON.stringify([...SIZES, 512])}) {
      const c = document.createElement('canvas')
      c.width = c.height = s
      const g = c.getContext('2d')
      g.imageSmoothingQuality = 'high'
      g.drawImage(img, 0, 0, s, s)
      out[s] = c.toDataURL('image/png').split(',')[1]
    }
    return out
  })()`)
  const buf = (s) => Buffer.from(pngs[s], 'base64')
  fs.writeFileSync(path.join(__dirname, name + '.png'), buf(512))

  // ICO with embedded PNG entries (supported since Vista).
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(SIZES.length, 4)
  const dir = Buffer.alloc(16 * SIZES.length)
  let offset = 6 + dir.length
  const datas = SIZES.map((s, i) => {
    const d = buf(s), o = i * 16
    dir.writeUInt8(s >= 256 ? 0 : s, o); dir.writeUInt8(s >= 256 ? 0 : s, o + 1)
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(d.length, o + 8); dir.writeUInt32LE(offset, o + 12)
    offset += d.length
    return d
  })
  fs.writeFileSync(path.join(__dirname, name + '.ico'), Buffer.concat([header, dir, ...datas]))
  app.quit()
})
