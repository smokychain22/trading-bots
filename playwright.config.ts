import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3100",
    channel: process.platform === "win32" ? "chrome" : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx src/index.ts",
    url: "http://localhost:3100/healthz",
    reuseExistingServer: false,
    env: {
      PORT: "3100",
      NODE_ENV: "test",
      THETA_READINESS_TOKEN: "synthetic-browser-test-operator-access-only",
    },
  },
});
