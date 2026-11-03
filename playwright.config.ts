import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4173/19-bubble-pwa/",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve-test.mjs",
    url: "http://127.0.0.1:4173/19-bubble-pwa/",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.USE_SYSTEM_CHROME ? "chrome" : undefined,
      },
    },
    { name: "webkit", use: { ...devices["iPad (gen 7)"] } },
  ],
});
