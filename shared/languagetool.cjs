"use strict";

const http = require("http");
const https = require("https");
const { spawnSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const LT_JAR_NAME = "languagetool.jar";
const LT_PORT = 8081;
const LT_PUBLIC_API = "https://languagetool.org/api/v2";

class LanguageToolService {
  constructor() {
    this.serverProcess = null;
    this.localUrl = null;
    this.mode = "none";
    this._checkCache = new Map();
    this._suggestCache = new Map();
    this.cacheTtl = 5 * 60 * 1000;
  }

  _httpRequest(options, body) {
    return new Promise((resolve, reject) => {
      const protocol = options.protocol === "https:" ? https : http;
      const req = protocol.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${e.message}`));
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
      if (body) req.write(body);
      req.end();
    });
  }

  _findJava() {
    const isWin = process.platform === "win32";
    const which = isWin ? "where.exe" : "which";
    try {
      const res = spawnSync(which, ["java"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: 5000,
      });
      if (res && res.status === 0 && res.stdout) {
        const javaPath = res.stdout.trim().split(/\r?\n/)[0];
        if (javaPath && fs.existsSync(javaPath)) return javaPath;
      }
    } catch { }
    return null;
  }

  _findJar() {
    const candidates = [
      path.join(process.cwd(), "assets", LT_JAR_NAME),
      path.join(process.cwd(), LT_JAR_NAME),
      path.join(__dirname, "..", "assets", LT_JAR_NAME),
      path.join(__dirname, "..", "..", "assets", LT_JAR_NAME),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  async startLocalServer() {
    if (this.mode === "local" && this.localUrl) return true;
    if (this.mode === "local" && !this.localUrl) this.stopLocalServer();

    const jarPath = this._findJar();
    if (!jarPath) {
      console.log("[langtool] No languagetool.jar found, cannot start local server");
      return false;
    }

    const javaPath = this._findJava();
    if (!javaPath) {
      console.log("[langtool] Java not found, cannot start local server");
      return false;
    }

    try {
      const res = spawnSync(javaPath, ["-version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: 5000,
      });
      if (!res || res.status !== 0) {
        console.log("[langtool] Java runtime check failed");
        return false;
      }
    } catch {
      console.log("[langtool] Java runtime check failed");
      return false;
    }

    return new Promise((resolve) => {
      try {
        this.serverProcess = spawn(javaPath, [
          "-jar", jarPath,
          "--server",
          "--port", String(LT_PORT),
          "--allow-origin", "*",
        ], {
          detached: false,
          stdio: ["ignore", "ignore", "ignore"],
        });

        this.serverProcess.on("error", (err) => {
          console.log(`[langtool] Server process error: ${err.message}`);
          this.serverProcess = null;
          this.localUrl = null;
          this.mode = "none";
          resolve(false);
        });

        this.serverProcess.on("exit", (code) => {
          console.log(`[langtool] Server process exited with code ${code}`);
          this.serverProcess = null;
          this.localUrl = null;
          this.mode = "none";
        });

        const startTime = Date.now();
        const checkInterval = setInterval(async () => {
          if (Date.now() - startTime > 15000) {
            clearInterval(checkInterval);
            if (this.serverProcess) {
              try { this.serverProcess.kill(); } catch { }
              this.serverProcess = null;
            }
            this.localUrl = null;
            this.mode = "none";
            resolve(false);
          }
          try {
            await this._httpRequest({
              hostname: "localhost",
              port: LT_PORT,
              path: "/v2/check",
              method: "POST",
              headers: { "Content-Type": "application/json" },
            }, JSON.stringify({ text: "test", language: "en-US" }));
            clearInterval(checkInterval);
            this.localUrl = `http://localhost:${LT_PORT}`;
            this.mode = "local";
            console.log(`[langtool] Local server started at ${this.localUrl}`);
            resolve(true);
          } catch { }
        }, 500);
      } catch (e) {
        console.log(`[langtool] Failed to start local server: ${e.message}`);
        resolve(false);
      }
    });
  }

  stopLocalServer() {
    if (this.serverProcess) {
      try { this.serverProcess.kill(); } catch { }
      this.serverProcess = null;
    }
    this.localUrl = null;
    this.mode = "none";
  }

  _pingPublicApi() {
    return new Promise((resolve) => {
      const urlObj = new URL(`${LT_PUBLIC_API}/languages`);
      const req = (urlObj.protocol === "https:" ? https : http).get(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
          path: urlObj.pathname,
          headers: { "User-Agent": "IndexArc/2.0" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode >= 200 && res.statusCode < 500);
        }
      );
      req.setTimeout(3000, () => {
        req.destroy();
        resolve(false);
      });
      req.on("error", () => resolve(false));
    });
  }

  async _ensureAvailable() {
    if (this.mode === "local" && this.localUrl) return true;
    if (this.mode === "public") return true;
    if (this.mode === "none") return false;

    const started = await this.startLocalServer();
    if (started) return true;

    const reachable = await this._pingPublicApi();
    if (reachable) {
      this.mode = "public";
      console.log("[langtool] Using public API fallback");
      return true;
    }

    this.mode = "none";
    console.log("[langtool] Public API unreachable, using local SymSpell engines");
    return false;
  }

  async _post(url, body) {
    const urlObj = new URL(url);
    return this._httpRequest({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "IndexArc/2.0",
      },
    }, JSON.stringify(body));
  }

  async check(text, language) {
    if (!await this._ensureAvailable()) return [];

    const cacheKey = `${language}:${text}`;
    const cached = this._checkCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.cacheTtl) return cached.result;

    let result;
    try {
      if (this.mode === "local") {
        result = await this._post(`${this.localUrl}/v2/check`, { text, language });
      } else {
        result = await this._post(`${LT_PUBLIC_API}/check`, { text, language });
      }
    } catch (e) {
      console.log(`[langtool] Check failed: ${e.message}`);
      if (this.mode === "local") {
        this.mode = "public";
        try {
          result = await this._post(`${LT_PUBLIC_API}/check`, { text, language });
        } catch {
          return [];
        }
      } else {
        return [];
      }
    }

    this._checkCache.set(cacheKey, { result, ts: Date.now() });
    if (this._checkCache.size > 500) {
      const firstKey = this._checkCache.keys().next().value;
      this._checkCache.delete(firstKey);
    }

    return result.matches || [];
  }

  async checkWords(words, language) {
    const text = words.join(" ");
    const matches = await this.check(text, language);
    const badSet = new Set();
    for (const m of matches) {
      const start = m.offset;
      const end = m.offset + m.length;
      const badWord = text.slice(start, end);
      badSet.add(badWord);
    }
    return words.filter((w) => badSet.has(w));
  }

  async suggest(word, language, limit) {
    const max = typeof limit === "number" && limit > 0 ? limit : 6;
    const cacheKey = `${language}:${word}:${max}`;
    const cached = this._suggestCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.cacheTtl) return cached.result;

    const matches = await this.check(word, language);
    const suggestions = [];
    const seen = new Set();
    for (const m of matches) {
      for (const r of m.replacements || []) {
        if (!seen.has(r.value)) {
          seen.add(r.value);
          suggestions.push(r.value);
        }
      }
      if (suggestions.length >= max) break;
    }

    const result = suggestions.slice(0, max);
    this._suggestCache.set(cacheKey, { result, ts: Date.now() });
    return result;
  }

  async isCorrect(word, language) {
    const matches = await this.check(word, language);
    return matches.length === 0;
  }

  getAvailable() {
    return this.mode !== "none";
  }

  getMode() {
    return this.mode;
  }
}

let globalLt = null;

function getLanguageTool() {
  if (!globalLt) globalLt = new LanguageToolService();
  return globalLt;
}

async function ensureLanguageTool() {
  const lt = getLanguageTool();
  await lt._ensureAvailable();
  return lt;
}

module.exports = {
  LanguageToolService,
  getLanguageTool,
  ensureLanguageTool,
};