import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3199);
export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "off", locale: "es-BO", timezoneId: "America/La_Paz" },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } }, testIgnore: /movil\.spec\.ts/ },
    { name: "celular", use: { ...devices["Pixel 7"] }, testMatch: /movil\.spec\.ts/ },
  ],
  webServer: {
    command: "npx tsx e2e/server.ts",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
  },
});
