import { describe, it, expect } from "vitest";
import {
  buildEncryptedExport,
  buildEnvExport,
  detectFormat,
  envKey,
  parseCsvRows,
  parseEnv,
  parseImport,
  withoutDuplicates,
} from "./porting.js";
import type { VaultEntry } from "./types.js";

const entry = (name: string, value: string, extra: Partial<VaultEntry> = {}): VaultEntry => ({
  id: name,
  value,
  type: "api key",
  name,
  raw_fragment: "",
  labels: [],
  type_aliases: [],
  status: "saved",
  family: "secret",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  ...extra,
});

describe(".env", () => {
  it("parses comments, export, quotes, escapes and inline comments", () => {
    const r = parseEnv(
      [
        "# comment",
        "export OPENAI_API_KEY=sk-abc123 # inline",
        'DB_PASSWORD="p@ss \\"word\\"\\nline2"',
        "SINGLE='keep $raw'",
        "EMPTY=",
        "not a line",
      ].join("\n")
    );
    expect(r.candidates.map((c) => [c.name, c.value, c.type])).toEqual([
      ["OPENAI_API_KEY", "sk-abc123", "api key"],
      ["DB_PASSWORD", 'p@ss "word"\nline2', "password"],
      ["SINGLE", "keep $raw", "environment variable"],
    ]);
    expect(r.skipped).toEqual({ "empty value": 1, "unparsed line": 1 });
  });

  it("export round-trips through the parser, with unique keys", () => {
    const entries = [entry("Stripe key", "sk_live_1"), entry("stripe-key", 'we"ird $val\nx'), entry("9lives", "a b")];
    const text = buildEnvExport(entries);
    expect(text).toContain("STRIPE_KEY=sk_live_1");
    expect(text).toContain("STRIPE_KEY_2=");
    expect(text).toContain("_9LIVES=");
    const back = parseEnv(text).candidates.map((c) => c.value);
    expect(back).toEqual(["sk_live_1", 'we"ird $val\nx', "a b"]);
    expect(envKey("  ")).toBe("SECRET");
  });
});

describe("password-manager formats", () => {
  it("Bitwarden JSON: logins → password + TOTP + fields; cards skipped", async () => {
    const bw = JSON.stringify({
      encrypted: false,
      items: [
        { type: 1, name: "GitHub", notes: "work", login: { username: "me", password: "gh-pass", totp: "JBSWY3DP", uris: [{ uri: "https://github.com/login" }] }, fields: [{ name: "PAT", value: "ghp_x" }] },
        { type: 2, name: "Recovery codes", notes: "1111 2222" },
        { type: 3, name: "Visa", card: { number: "4111" } },
      ],
    });
    expect(detectFormat(bw)).toBe("bitwarden");
    const r = await parseImport(bw);
    expect(r.candidates.map((c) => [c.name, c.value, c.type])).toEqual([
      ["GitHub", "gh-pass", "password"],
      ["GitHub TOTP", "JBSWY3DP", "totp seed"],
      ["GitHub PAT", "ghp_x", "secret"],
      ["Recovery codes", "1111 2222", "note"],
    ]);
    expect(r.candidates[0].notes).toContain("username: me");
    expect(r.candidates[0].labels).toContain("github.com");
    expect(r.skipped).toEqual({ "card (not imported)": 1 });
    await expect(parseImport(JSON.stringify({ encrypted: true, items: [] }))).rejects.toThrow(/encrypted Bitwarden/);
  });

  it("CSV (1Password / KeePassXC style) with quoted commas and newlines", async () => {
    const csv = 'Title,Username,Password,URL,Notes,Group\r\n"AWS, prod",admin,"pa,ss",https://aws.amazon.com,"multi\nline",Infra\r\nEmpty,,,,,\r\n';
    expect(parseCsvRows(csv)[1]).toEqual(["AWS, prod", "admin", "pa,ss", "https://aws.amazon.com", "multi\nline", "Infra"]);
    const r = await parseImport(csv, { filename: "export.csv" });
    expect(r.format).toBe("csv");
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ name: "AWS, prod", value: "pa,ss" });
    expect(r.candidates[0].labels).toEqual(expect.arrayContaining(["keepass", "aws.amazon.com", "Infra"]));
    expect(r.skipped).toEqual({ "no secret value": 1 });
  });

  it("KeePass XML: current entries only, custom strings, entities", async () => {
    const xml = `<?xml version="1.0"?><KeePassFile><Root><Group><Entry>
      <String><Key>Title</Key><Value>DB &amp; cache</Value></String>
      <String><Key>UserName</Key><Value>root</Value></String>
      <String><Key>Password</Key><Value ProtectInMemory="True">s3cr&lt;t</Value></String>
      <String><Key>API token</Key><Value>tok-1</Value></String>
      <History><Entry><String><Key>Password</Key><Value>OLD</Value></String></Entry></History>
    </Entry></Group></Root></KeePassFile>`;
    const r = await parseImport(xml);
    expect(r.format).toBe("keepass-xml");
    expect(r.candidates.map((c) => [c.name, c.value])).toEqual([
      ["DB & cache", "s3cr<t"],
      ["DB & cache API token", "tok-1"],
    ]);
  });
});

describe("encrypted IndexArc export", () => {
  it("round-trips; wrong passphrase and tampering fail; short passphrase refused", async () => {
    const entries = [entry("A", "value-a", { notes: "n" }), entry("B", "value-b", { family: "note", type: "note" })];
    const file = await buildEncryptedExport(entries, "correct horse battery");
    expect(file).not.toContain("value-a");
    expect(detectFormat(file)).toBe("indexarc");
    const r = await parseImport(file, { passphrase: "correct horse battery" });
    expect(r.candidates.map((c) => [c.name, c.value, c.family, c.notes])).toEqual([
      ["A", "value-a", "secret", "n"],
      ["B", "value-b", "note", undefined],
    ]);
    await expect(parseImport(file, { passphrase: "wrong passphrase!!" })).rejects.toThrow(/Wrong passphrase/);
    const j = JSON.parse(file);
    j.ciphertext = Buffer.from(Buffer.from(j.ciphertext, "base64").map((b, i) => (i === 3 ? b ^ 1 : b))).toString("base64");
    await expect(parseImport(JSON.stringify(j), { passphrase: "correct horse battery" })).rejects.toThrow(/Wrong passphrase|damaged/);
    await expect(buildEncryptedExport(entries, "short")).rejects.toThrow(/at least 12/);
  });

  it("drops candidates already in the vault", () => {
    const r = withoutDuplicates(
      { format: "env", skipped: {}, candidates: [{ name: "A", value: "1", type: "x", family: "secret", labels: [] }, { name: "A", value: "2", type: "x", family: "secret", labels: [] }, { name: "A", value: "2", type: "x", family: "secret", labels: [] }] },
      [entry("A", "1")]
    );
    expect(r.candidates.map((c) => c.value)).toEqual(["2"]);
    expect(r.skipped["already in vault"]).toBe(2);
  });
});
