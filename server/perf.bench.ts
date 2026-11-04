import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Performance budgets (roadmap bar #5): a 10k-entry encrypted vault, timed in
// CI by `npm run bench` (vitest.bench.config.ts). Not part of `npm test`.
//
// "save" is what a save writes to storage: the sealed entry row plus its
// vector row. "ask" is the local Ask pipeline (keyword scoring of all
// entries, then the vector re-rank over every row); the embedding call and
// the LLM answer are stubbed, since they time the model, not IndexArc.
//
// Results go to stdout and, when BENCH_OUT is set, to a JSON file the CI job
// publishes in its summary.

const DIM = 384;
vi.mock("./ai/providers.js", async (importOriginal) => {
  const real: any = await importOriginal();
  return {
    ...real,
    resolveActiveProvider: async () => "local",
    embedText: async () => Array.from({ length: DIM }, (_, j) => Math.cos(j)),
    embedModelId: () => "bench-embed",
    isLocalProvider: () => true,
    generateText: async () => ({ text: "", provider_used: "bench" }),
  };
});

const { VaultStore } = await import("./store.js");
const { ensurePortableLayout } = await import("./paths.js");
const { closeAllRecordDbs } = await import("./db/recordDb.js");
const { askVault } = await import("./services/ask.js");

/** Budgets in milliseconds. p95 where a series is measured, else one run. */
export const BUDGETS = {
  unlock: 1500,
  list: 1500,
  save_p95: 50,
  update_p95: 50,
  delete_p95: 50,
  ask_p95: 300,
};

const N = 10_000;
const SAMPLES = 40;

function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}

describe(`storage and Ask at ${N} entries`, () => {
  let tmpDir: string;
  const prevEmergency = process.env.INDEXARC_EMERGENCY_DIR;
  const PASSWORD = "bench-orchid-lantern-42";
  const results: Record<string, number> = {};

  const entry = (value: string, name: string) => ({
    value,
    type: "api key",
    name,
    raw_fragment: "",
    labels: ["bench"],
    type_aliases: [],
    status: "saved" as const,
    family: "secret" as const,
  });
  const vector = (entryId: string, seed: number) => ({
    id: `${entryId}-c0`,
    entry_id: entryId,
    text: `chunk for ${entryId}`,
    embedding: Array.from({ length: DIM }, (_, j) => Math.sin(seed + j)),
    embed_model: "bench-embed",
    metadata: { name: entryId, type: "api key", family: "secret", value_preview: "v…" },
  });

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-bench-"));
    process.env.INDEXARC_EMERGENCY_DIR = path.join(tmpDir, "emergency-shared");
    const paths = ensurePortableLayout(tmpDir);
    const store = new VaultStore(paths);
    await store.setupPassword(PASSWORD);
    const now = new Date().toISOString();
    const entries = Array.from({ length: N }, (_, i) => ({
      ...entry(`value-${i}-${"x".repeat(i % 40)}`, `service ${i % 97} key ${i}`),
      id: `e${i}`,
      created_at: now,
      updated_at: now,
    }));
    (store as any).writeDbTables(entries, entries.map((e, i) => vector(e.id, i)));
    store.lock();
    closeAllRecordDbs();
  }, 300_000);

  afterAll(() => {
    closeAllRecordDbs();
    if (prevEmergency === undefined) delete process.env.INDEXARC_EMERGENCY_DIR;
    else process.env.INDEXARC_EMERGENCY_DIR = prevEmergency;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const report = { entries: N, samples: SAMPLES, ms: results, budgets: BUDGETS, node: process.version, platform: process.platform };
    console.log("[bench]", JSON.stringify(report));
    if (process.env.BENCH_OUT) fs.writeFileSync(process.env.BENCH_OUT, JSON.stringify(report, null, 2));
  });

  it("meets the budgets", async () => {
    const paths = ensurePortableLayout(tmpDir);
    const store = new VaultStore(paths);
    const timed = async (fn: () => unknown) => {
      const s = performance.now();
      await fn();
      return performance.now() - s;
    };

    results.unlock = await timed(() => store.unlock(PASSWORD));
    results.list = await timed(() => store.listEntries());
    expect(store.listEntries()).toHaveLength(N);

    const save: number[] = [];
    const update: number[] = [];
    const del: number[] = [];
    const ask: number[] = [];
    const created: string[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      save.push(
        await timed(() => {
          const e = store.createEntry(entry(`bench-new-${i}`, `bench new ${i}`));
          store.upsertVector(vector(e.id, N + i));
          created.push(e.id);
        })
      );
      update.push(await timed(() => store.updateEntry(`e${i * 97}`, { value: `changed-${i}` })));
    }
    for (const id of created) del.push(await timed(() => store.deleteEntry(id)));
    const settings = store.getSettings();
    const queries = ["service 12 key", "where is the stripe key", "bench", "value-9999", "api key for service 42"];
    for (let i = 0; i < SAMPLES / 2; i++) {
      ask.push(await timed(() => askVault(store, settings, queries[i % queries.length], 12)));
    }

    results.save_p95 = p95(save);
    results.update_p95 = p95(update);
    results.delete_p95 = p95(del);
    results.ask_p95 = p95(ask);
    for (const k of Object.keys(results)) results[k] = Math.round(results[k] * 10) / 10;

    const over = (Object.keys(BUDGETS) as (keyof typeof BUDGETS)[]).filter((k) => results[k] > BUDGETS[k]);
    expect(over.map((k) => `${k}: ${results[k]} ms > ${BUDGETS[k]} ms`)).toEqual([]);
  }, 600_000);
});
