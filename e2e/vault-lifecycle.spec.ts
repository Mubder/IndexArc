// Electron end-to-end (R4): launch → set password → paste → save → lock →
// restart → unlock → the entry is still there, and was encrypted at rest.
//
// Runs the real app (electron-main.cjs + the built dist/) against a scratch
// data root. Build first: `npm run build`, then `npm run test:e2e`.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-e2e-"));
// Generated per run; never a real password.
const PASSWORD = `e2e-${crypto.randomBytes(9).toString("base64url")}`;
const SECRET = `sk_test_e2e${crypto.randomBytes(10).toString("hex")}`;

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [path.resolve("electron-main.cjs")],
    env: { ...process.env, INDEXARC_ROOT: ROOT, ELECTRON_ENABLE_LOGGING: "0" },
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}

/** Close the app the normal way (quit runs the flush handshake). */
async function quit(app: ElectronApplication) {
  await app.evaluate(({ app }) => app.quit());
  await app.waitForEvent("close", { timeout: 30_000 }).catch(() => {});
}

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test("vault survives lock and restart, encrypted at rest", async () => {
  test.setTimeout(240_000);

  // 1) First launch: a new vault requires a master password.
  let { app, page } = await launch();
  const pw = page.locator('input[type="password"]');
  await expect(pw.first()).toBeVisible({ timeout: 60_000 });
  await pw.nth(0).fill(PASSWORD);
  await pw.nth(1).fill(PASSWORD);
  await page.locator("form button[type=submit], form button").last().click();

  // 2) Unlocked shell. Use the built-in rules (no AI) so the run is
  //    deterministic: point Ollama at a closed port.
  await expect(page.locator("aside nav")).toBeVisible({ timeout: 60_000 });
  const patched = await page.evaluate(async () => {
    const r = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai_provider: "local", ollama_base_url: "http://127.0.0.1:9" }),
    });
    return r.ok;
  });
  expect(patched).toBe(true);

  // 3) Paste → analyze → save everything selected.
  await page.locator("aside nav button", { hasText: /Paste/ }).click();
  await page.locator("main textarea").first().fill(`STRIPE_SECRET_KEY=${SECRET}\n`);
  await page.locator("main button", { hasText: /^\s*Analyze/ }).first().click();
  const save = page.locator("main button", { hasText: /Save/ }).first();
  await expect(save).toBeEnabled({ timeout: 90_000 });
  await save.click();
  await expect
    .poll(async () => page.evaluate(async () => (await (await fetch("/api/entries")).json()).length), { timeout: 30_000 })
    .toBeGreaterThan(0);

  // 4) The secret is not on disk in plain text.
  const dataDir = path.join(ROOT, "data");
  for (const f of fs.readdirSync(dataDir)) {
    const p = path.join(dataDir, f);
    if (fs.statSync(p).isFile()) expect(fs.readFileSync(p, "utf8")).not.toContain(SECRET);
  }

  // 5) Lock: the UI shows the lock screen and the API refuses data.
  await page.locator("aside button", { hasText: /Lock now/i }).click();
  await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 20_000 });
  const lockedStatus = await page.evaluate(async () => (await fetch("/api/entries")).status);
  expect(lockedStatus).toBe(423);
  await quit(app);

  // 6) Restart → unlock → the entry is back.
  ({ app, page } = await launch());
  const unlock = page.locator('input[type="password"]').first();
  await expect(unlock).toBeVisible({ timeout: 60_000 });
  await unlock.fill(PASSWORD);
  await unlock.press("Enter");
  await expect(page.locator("aside nav")).toBeVisible({ timeout: 60_000 });
  const values = await page.evaluate(async () => (await (await fetch("/api/entries")).json()).map((e: { value: string }) => e.value));
  expect(values).toContain(SECRET);

  // 7) A wrong password is refused after a restart.
  await page.locator("aside button", { hasText: /Lock now/i }).click();
  await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 20_000 });
  const wrong = await page.evaluate(async () => {
    const r = await fetch("/api/vault/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "definitely-wrong" }),
    });
    return r.status;
  });
  expect(wrong).toBeGreaterThanOrEqual(400);
  await quit(app);
});
