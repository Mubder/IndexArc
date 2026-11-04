import { defineConfig } from "@playwright/test";

// Electron end-to-end tests (R4). Vitest owns *.test.ts; Playwright owns
// e2e/*.spec.ts. Requires a fresh `npm run build`.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  timeout: 240_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure" },
});
