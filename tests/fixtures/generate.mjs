// Generates the synthetic clips the test suite runs against into ./out (gitignored).
// Idempotent: a stamp of the recipe list is kept next to the output, and the whole
// set is rebuilt only when a recipe changes. Requires ffmpeg on PATH.
//
//   node tests/fixtures/generate.mjs          # generate if missing/stale
//   node tests/fixtures/generate.mjs --force  # rebuild everything

import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

export const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out')
const STAMP = join(OUT, '.stamp')

// Small, keyframe-dense H.264 so seeks land quickly and generation stays fast.
const H264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '15']
const AAC = ['-c:a', 'aac', '-b:a', '64k']

function av(seconds, { w = 640, h = 360, audio = true, freq = 440 } = {}) {
  const inputs = ['-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=30:d=${seconds}`]
  if (audio) inputs.push('-f', 'lavfi', '-i', `sine=f=${freq}:d=${seconds}`)
  return inputs
}

/** name → ffmpeg args (output path appended), or a function writing the file itself. */
const RECIPES = {
  'd3.mp4': [...av(3), ...H264, ...AAC, '-movflags', '+faststart'],
  'd5.mp4': [...av(5), ...H264, ...AAC, '-movflags', '+faststart'],
  'd5b.mp4': [...av(5.1, { freq: 660 }), ...H264, ...AAC, '-movflags', '+faststart'],
  'd8.mp4': [...av(8), ...H264, ...AAC, '-movflags', '+faststart'],
  'd12.mp4': [...av(12), ...H264, ...AAC, '-movflags', '+faststart'],
  'portrait6.mp4': [...av(6, { w: 360, h: 640 }), ...H264, ...AAC, '-movflags', '+faststart'],
  // ffmpeg's default mp4 layout writes the moov atom after the media data.
  'endmoov8.mp4': [...av(8), ...H264, ...AAC],
  'noaudio5.mp4': [...av(5, { audio: false }), ...H264, '-movflags', '+faststart'],
  // Chromium drops AC-3 audio silently and plays the picture alone.
  'ac3audio5.mp4': [...av(5), ...H264, '-c:a', 'ac3', '-movflags', '+faststart'],
  'clip6.webm': [...av(6), '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '300k', '-c:a', 'libopus'],
  'clip6.mkv': [...av(6), ...H264, ...AAC],
  'clip6.mov': [...av(6), ...H264, ...AAC, '-movflags', '+faststart'],
  'broken.mp4': (p) => {
    // Deterministic garbage with an .mp4 name: Chromium must refuse it.
    const buf = Buffer.alloc(64 * 1024)
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 2654435761) >>> 24
    writeFileSync(p, buf)
  },
  'folder/a.mp4': [...av(3), ...H264, ...AAC, '-movflags', '+faststart'],
  'folder/b.webm': [...av(3), '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus'],
  'folder/C.MKV': [...av(3), ...H264, ...AAC],
  'folder/notes.txt': (p) => writeFileSync(p, 'not a video\n'),
  'folder/image.png': (p) => writeFileSync(p, Buffer.from('89504e470d0a1a0a', 'hex')),
  'folder/sub/nested.mp4': [...av(3), ...H264, ...AAC, '-movflags', '+faststart']
}
// Nine 10 s clips: more simultaneous videos than Chromium's 6-per-origin HTTP/1.1 cap.
for (let i = 1; i <= 9; i++) {
  RECIPES[`many/m${i}.mp4`] = [...av(10, { w: 320, h: 180, freq: 200 + i * 50 }), ...H264, ...AAC, '-movflags', '+faststart']
}
// Fourteen 60 s clips: well past Chromium's 10-request network budget.
// Padded to a constant 4 Mbps (~30 MB) because Chromium caches any file under
// 25 MB whole; bigger ones stream, holding their download open while they play.
// One encode, copied: each copy is still its own server and URL.
RECIPES['long/l1.mp4'] = [
  ...av(60, { w: 320, h: 180 }),
  ...H264,
  '-b:v', '4M', '-minrate', '4M', '-maxrate', '4M', '-bufsize', '1M', '-x264-params', 'nal-hrd=cbr',
  ...AAC,
  '-movflags', '+faststart'
]
for (let i = 2; i <= 14; i++) {
  RECIPES[`long/l${i}.mp4`] = (p) => copyFileSync(join(OUT, 'long/l1.mp4'), p)
}

function recipeHash() {
  const plain = Object.fromEntries(
    Object.entries(RECIPES).map(([k, v]) => [k, typeof v === 'function' ? v.toString() : v])
  )
  return createHash('sha1').update(JSON.stringify(plain)).digest('hex')
}

export function generate({ force = false, log = console.log } = {}) {
  const hash = recipeHash()
  const fresh = existsSync(STAMP) && readFileSync(STAMP, 'utf8') === hash
  if (fresh && !force) return OUT

  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('ffmpeg not found on PATH — it is required to generate test fixtures (winget install ffmpeg)')
  }
  rmSync(OUT, { recursive: true, force: true })
  for (const [name, recipe] of Object.entries(RECIPES)) {
    const out = join(OUT, name)
    mkdirSync(dirname(out), { recursive: true })
    log(`fixture: ${name}`)
    if (typeof recipe === 'function') {
      recipe(out)
      continue
    }
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...recipe, '-shortest', out], {
      encoding: 'utf8'
    })
    if (r.status !== 0) throw new Error(`ffmpeg failed for ${name}:\n${r.stderr}`)
  }
  writeFileSync(STAMP, hash)
  return OUT
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  generate({ force: process.argv.includes('--force') })
}
