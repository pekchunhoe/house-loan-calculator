import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.browser.spec.js', fullyParallel: false, workers: 1,
  timeout: 45000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', launchOptions: process.platform === 'win32' ? { channel: 'msedge' } : {}, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true }
});
