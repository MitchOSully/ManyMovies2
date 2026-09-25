import { spawnSync } from 'child_process'
import { join } from 'path'

/** Generates fixtures if missing or stale (same script as `npm run test:fixtures`). */
export default function globalSetup(): void {
  const r = spawnSync(process.execPath, [join(__dirname, '../fixtures/generate.mjs')], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('fixture generation failed')
}
