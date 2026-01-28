import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './.hakim/test_scripts',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list', { printSteps: true }]],
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:4012',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:4012',
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
})
