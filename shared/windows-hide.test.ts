// Every child process the app starts must pass windowsHide: true. Without it
// Windows opens a console window for console programs (ollama, java, reg,
// powershell…), which users see as a terminal flashing up and vanishing.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const CALL = /\b(spawn|spawnSync|execFile|execFileSync|execSync|exec)\(/g;

function sources(): string[] {
  const out = ["electron-main.cjs", "preload.cjs"].map((f) => path.join(ROOT, f));
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.(c?js|ts)$/.test(d.name) && !/\.(test|bench|spec)\./.test(d.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, "shared"));
  walk(path.join(ROOT, "server"));
  return out.filter((p) => fs.existsSync(p));
}

/** The text of the call starting at `start` (up to its closing parenthesis). */
function callText(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

describe("child processes never open a console window", () => {
  it("every spawn/exec passes windowsHide: true", () => {
    const missing: string[] = [];
    for (const file of sources()) {
      const src = fs.readFileSync(file, "utf8");
      if (!/child_process/.test(src)) continue;
      for (const m of src.matchAll(CALL)) {
        const before = src.slice(Math.max(0, m.index! - 1), m.index!);
        if (before === ".") continue; // regex.exec(), db.exec(), and the like
        const call = callText(src, m.index! + m[0].length - 1);
        if (!/windowsHide:\s*true/.test(call)) {
          const line = src.slice(0, m.index).split("\n").length;
          missing.push(`${path.relative(ROOT, file)}:${line} ${m[1]}(…)`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
