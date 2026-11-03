import { describe, it, expect } from "vitest";
import { dailyCounts, addedWithin, cumulative, sparkPoints, relativeTime, healthScore, orderChecks, previewOf } from "./homeStats";
import type { VaultEntry, HealthCheckRow } from "../../types";

const NOW = new Date(2026, 10, 4, 15, 0, 0).getTime();
const at = (daysAgo: number, hour = 12) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const entry = (p: Partial<VaultEntry>): VaultEntry => ({
  id: "x", value: "", type: "t", name: "n", raw_fragment: "", labels: [], type_aliases: [],
  status: "saved", family: "note", created_at: at(0), updated_at: at(0), ...p,
});

describe("dailyCounts", () => {
  it("buckets by local day, oldest first, and skips bad dates", () => {
    const list = [entry({ created_at: at(0) }), entry({ created_at: at(0, 1) }), entry({ created_at: at(2) }), entry({ created_at: at(30) }), entry({ created_at: "nope" })];
    expect(dailyCounts(list, 3, NOW)).toEqual([1, 0, 2]);
    expect(addedWithin(list, 7, NOW)).toBe(3);
  });
});

describe("cumulative", () => {
  it("adds a running total on top of the base", () => {
    expect(cumulative([1, 0, 2], 10)).toEqual([11, 11, 13]);
  });
});

describe("sparkPoints", () => {
  it("maps min to the bottom and max to the top", () => {
    expect(sparkPoints([0, 10], 100, 20, 0)).toBe("0.0,20.0 100.0,0.0");
  });
  it("draws a flat series in the middle", () => {
    expect(sparkPoints([5, 5], 10, 20, 0)).toBe("0.0,10.0 10.0,10.0");
  });
  it("returns nothing for no data", () => {
    expect(sparkPoints([], 10, 10)).toBe("");
  });
});

describe("relativeTime", () => {
  it("uses short units in both languages", () => {
    expect(relativeTime(new Date(NOW - 30_000).toISOString(), "en", NOW)).toBe("now");
    expect(relativeTime(new Date(NOW - 5 * 60_000).toISOString(), "en", NOW)).toBe("5 min");
    expect(relativeTime(new Date(NOW - 3 * 3_600_000).toISOString(), "ar", NOW)).toBe("3 س");
    expect(relativeTime("bad", "en", NOW)).toBe("");
  });
});

describe("health", () => {
  const checks: HealthCheckRow[] = [
    { id: "a", label: "A", severity: "info", ok: false, detail: "" },
    { id: "b", label: "B", severity: "critical", ok: true, detail: "" },
    { id: "c", label: "C", severity: "critical", ok: false, detail: "" },
  ];
  it("weights critical checks 3x", () => {
    expect(healthScore(checks)).toBe(43);
    expect(healthScore([])).toBeNull();
  });
  it("lists critical failures, then info failures, then passes", () => {
    expect(orderChecks(checks).map((c) => c.id)).toEqual(["c", "a", "b"]);
  });
});

describe("previewOf", () => {
  it("never shows a whole secret", () => {
    const p = previewOf(entry({ family: "secret", value: "sk-abcdefghijklmnop" }));
    expect(p).toBe("sk-a••••••••nop");
    expect(previewOf(entry({ family: "secret", value: "short" }))).toBe("••••••••");
  });
  it("collapses other values to one line", () => {
    expect(previewOf(entry({ family: "command", value: "git  status\n-s" }))).toBe("git status -s");
  });
});
