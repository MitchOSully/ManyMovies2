import { defineConfig } from '@playwright/test'

// Real playback timing: one app at a time, no retries (a pass-on-retry sync test
// is exactly the intermittent regression this suite exists to surface).
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results'
})
