#!/usr/bin/env node
// IndexArc CLI (R6.1): read secrets from the running, unlocked IndexArc app.
//
//   indexarc login                 store a CLI token (create one in Settings → CLI access)
//   indexarc status                check the connection and the token
//   indexarc get NAME [--id ID]    print one secret's value
//   indexarc env NAME… | --label L | --all        print KEY=value lines
//   indexarc run NAME… | --label L | --all -- cmd [args…]
//                                  run a command with the secrets in its environment
//   indexarc logout                forget the stored token
//
// Server URL: --url, INDEXARC_URL, or the runtime file the app writes
// (runtime.json in the per-user state folder, or INDEXARC_RUNTIME_FILE).
// Token: INDEXARC_TOKEN, or the file `login` writes (cli-token in that folder,
// or INDEXARC_TOKEN_FILE). The vault must be unlocked in the app.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const EXIT = { ok: 0, error: 1, usage: 2, locked: 3, auth: 4 };
// Same folder as server/cli.ts cliStateDir() — keep the two in sync.
function stateDir() {
  const home = os.homedir();
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "IndexArc", "cli");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "IndexArc", "cli");
  return path.join(process.env.XDG_STATE_HOME || path.join(home, ".local", "state"), "indexarc");
}
const runtimeFile = process.env.INDEXARC_RUNTIME_FILE || path.join(stateDir(), "runtime.json");
const tokenFile = process.env.INDEXARC_TOKEN_FILE || path.join(stateDir(), "cli-token");

class CliError extends Error {
  constructor(message, code = EXIT.error) {
    super(message);
    this.code = code;
  }
}

function parseArgs(argv) {
  const out = { _: [], rest: null, flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      out.rest = argv.slice(i + 1);
      break;
    }
    if (a === "--all" || a === "--help" || a === "-h") out.flags[a.replace(/^-+/, "")] = true;
    else if (a === "--label" || a === "--id" || a === "--url") {
      if (i + 1 >= argv.length) throw new CliError(`${a} needs a value`, EXIT.usage);
      out.flags[a.slice(2)] = argv[++i];
    } else if (a.startsWith("--")) throw new CliError(`Unknown option ${a}`, EXIT.usage);
    else out._.push(a);
  }
  return out;
}

function serverUrl(flags) {
  if (flags.url) return flags.url.replace(/\/+$/, "");
  if (process.env.INDEXARC_URL) return process.env.INDEXARC_URL.replace(/\/+$/, "");
  try {
    const j = JSON.parse(fs.readFileSync(runtimeFile, "utf8"));
    if (typeof j.url === "string") return j.url;
  } catch {
    /* fall through */
  }
  throw new CliError("IndexArc does not seem to be running (no runtime file). Start the app, or set INDEXARC_URL.");
}

function readToken() {
  if (process.env.INDEXARC_TOKEN) return process.env.INDEXARC_TOKEN.trim();
  try {
    return fs.readFileSync(tokenFile, "utf8").trim();
  } catch {
    throw new CliError("No CLI token. Create one in IndexArc → Settings → CLI access, then run `indexarc login`.", EXIT.auth);
  }
}

async function api(flags, method, p, body) {
  const url = serverUrl(flags) + p;
  const token = readToken();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new CliError(`Cannot reach IndexArc at ${serverUrl(flags)}. Is the app running?`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 423) throw new CliError("The vault is locked. Unlock IndexArc and try again.", EXIT.locked);
  if (res.status === 401) throw new CliError("The CLI token was rejected (revoked, or the master password changed). Create a new one in Settings → CLI access.", EXIT.auth);
  if (!res.ok) {
    const extra = Array.isArray(data.candidates) ? "\n" + data.candidates.map((c) => `  ${c.id}  ${c.name}`).join("\n") : "";
    throw new CliError((data.error || `Request failed (${res.status})`) + extra);
  }
  return data;
}

function envQuote(v) {
  if (/^[A-Za-z0-9_./:@%+-]*$/.test(v)) return v;
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
}

function envBody(args) {
  if (args.flags.all) return { all: true };
  if (args.flags.label) return { label: args.flags.label };
  if (args._.length) return { names: args._ };
  throw new CliError("Name the secrets, or pass --label LABEL or --all.", EXIT.usage);
}

async function fetchEnv(args) {
  const data = await api(args.flags, "POST", "/api/cli/env", envBody(args));
  if (data.missing?.length) throw new CliError(`Not found: ${data.missing.join(", ")}`);
  return data.env;
}

async function readStdinLine() {
  if (process.stdin.isTTY) process.stderr.write("Paste the CLI token: ");
  const chunks = [];
  for await (const c of process.stdin) {
    chunks.push(c);
    if (String(c).includes("\n")) break;
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8").trim();
}

const HELP = `IndexArc CLI

  indexarc login                          store a CLI token (Settings → CLI access)
  indexarc status                         check the connection and token
  indexarc get NAME [--id ID]             print one secret
  indexarc env NAME… | --label L | --all  print KEY=value lines
  indexarc run NAME… | --label L | --all -- cmd [args…]
  indexarc logout                         forget the stored token

Options: --url URL (or INDEXARC_URL). Token: INDEXARC_TOKEN or the login file.
Exit codes: 0 ok, 1 error, 2 usage, 3 vault locked, 4 token missing/rejected.`;

async function main(argv) {
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return EXIT.ok;
    case "login": {
      const t = args._[0] || (await readStdinLine());
      if (!/^iax_[A-Za-z0-9_-]{43}$/.test(t)) throw new CliError("That does not look like an IndexArc CLI token (iax_…).", EXIT.usage);
      fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
      fs.writeFileSync(tokenFile, t + "\n", { mode: 0o600 });
      console.error(`Saved to ${tokenFile}`);
      return EXIT.ok;
    }
    case "logout":
      fs.rmSync(tokenFile, { force: true });
      console.error("Token removed.");
      return EXIT.ok;
    case "status": {
      const url = serverUrl(args.flags);
      // An empty read: 400 means connected and authorised.
      const res = await fetch(url + "/api/cli/secret", { headers: { Authorization: `Bearer ${readToken()}` } }).catch(() => null);
      if (!res) throw new CliError(`Cannot reach IndexArc at ${url}.`);
      if (res.status === 423) throw new CliError(`Connected to ${url}, but the vault is locked.`, EXIT.locked);
      if (res.status === 401) throw new CliError(`Connected to ${url}, but the token was rejected.`, EXIT.auth);
      console.log(`Connected to ${url}; token OK; vault unlocked.`);
      return EXIT.ok;
    }
    case "get": {
      if (!args.flags.id && args._.length !== 1) throw new CliError("Usage: indexarc get NAME (or --id ID)", EXIT.usage);
      const q = args.flags.id ? `id=${encodeURIComponent(args.flags.id)}` : `name=${encodeURIComponent(args._[0])}`;
      const data = await api(args.flags, "GET", `/api/cli/secret?${q}`);
      process.stdout.write(data.value + (process.stdout.isTTY ? "\n" : ""));
      return EXIT.ok;
    }
    case "env": {
      const env = await fetchEnv(args);
      for (const [k, v] of Object.entries(env)) process.stdout.write(`${k}=${envQuote(v)}\n`);
      return EXIT.ok;
    }
    case "run": {
      if (!args.rest?.length) throw new CliError("Usage: indexarc run NAME… -- command [args…]", EXIT.usage);
      const env = await fetchEnv(args);
      const childEnv = { ...process.env, ...env };
      // Windows: go through the shell so `npm`, `.cmd` and `.bat` resolve; pass
      // one pre-quoted command line (args + shell:true is deprecated).
      const child =
        process.platform === "win32"
          ? spawn(args.rest.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)).join(" "), { stdio: "inherit", env: childEnv, shell: true })
          : spawn(args.rest[0], args.rest.slice(1), { stdio: "inherit", env: childEnv });
      for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
      return await new Promise((resolve) => {
        child.on("error", (e) => {
          console.error(`indexarc: ${e.message}`);
          resolve(127);
        });
        child.on("exit", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
      });
    }
    default:
      throw new CliError(`Unknown command "${cmd}". Run \`indexarc help\`.`, EXIT.usage);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`indexarc: ${e.message}`);
    process.exit(e instanceof CliError ? e.code : EXIT.error);
  }
);
