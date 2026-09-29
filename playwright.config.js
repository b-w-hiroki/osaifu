import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:8765',
    ...devices['iPhone 13'],
    browserName: 'chromium',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'python3 -m http.server 8765',
    url: 'http://localhost:8765',
    reuseExistingServer: !process.env.CI,
  },
});
