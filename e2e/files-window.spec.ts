// Electron E2E for the Files window: open a real .txt from disk through the
// normal CLI/association path, edit it in the CodeMirror source editor, save,
// inspect the version history and restore an older copy.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-files-e2e-"));
const FILES = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-files-docs-"));
const FILE = path.join(FILES, "note.txt");
fs.writeFileSync(FILE, "alpha beta gamma\nsecond line 42\n", "utf8");

const log: string[] = [];

async function docsWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const found = app.windows().find((p) => /surface=docs/.test(p.url()));
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No Files window; windows: ${app.windows().map((w) => w.url()).join(", ")}`);
}

/** Poll the file on disk until it reaches the expected content. */
async function diskIs(expected: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (fs.readFileSync(FILE, "utf8") === expected) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(fs.readFileSync(FILE, "utf8")).toBe(expected);
}

test("Files window edits, saves, keeps history and restores", async () => {
  const app = await electron.launch({
    args: [path.resolve("electron-main.cjs"), FILE],
    env: { ...process.env, INDEXARC_ROOT: ROOT, ELECTRON_ENABLE_LOGGING: "0" },
    timeout: 60_000,
  });
  try {
    app.process().stdout?.on("data", (d) => log.push(`[main] ${String(d).trimEnd()}`));
    app.process().stderr?.on("data", (d) => log.push(`[main:err] ${String(d).trimEnd()}`));
    const page = await docsWindow(app);
    page.on("pageerror", (e) => log.push(`[pageerror] ${e}`));
    await page.waitForLoadState("domcontentloaded");

    // The real file content is rendered in the source editor.
    await expect(page.locator(".cm-content")).toContainText("alpha beta gamma", { timeout: 30_000 });
    await expect(page.getByText(path.basename(FILE), { exact: true }).first()).toBeVisible();

    // Edit + Ctrl+S writes through the same trusted IPC the UI button uses.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("EDITED");
    const edited = "alpha beta gamma\nsecond line 42\nEDITED";
    await page.keyboard.press("Control+s");
    await diskIs(edited);

    // A version of the previous contents was kept on save.
    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByText("Saved versions")).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Restore" }).first().click();
    await diskIs("alpha beta gamma\nsecond line 42\n");

    // Regex find selects a variable-length match.
    await page.getByRole("button", { name: "Find" }).click();
    const find = page.getByPlaceholder("Find in this file");
    await find.fill("\\d+");
    await page.getByRole("button", { name: "Regular expression" }).click();
    await expect(page.getByText(/1 of 1/)).toBeVisible();
  } catch (e) {
    throw new Error(`${e}\n${log.join("\n")}`);
  } finally {
    await app.evaluate(({ app }) => app.quit()).catch(() => {});
  }
});
