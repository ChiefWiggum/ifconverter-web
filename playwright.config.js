// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: 'list',
    use: {
        baseURL: 'http://localhost:3000',
        trace: 'on-first-retry'
    },
    webServer: {
        command: 'npm start',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
