import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { updatePolicy, parsePublisherNames, compareVersions } = require("./updater.cjs");

describe("updater policy", () => {
  const base = { isPackaged: true, isPortable: false, platform: "win32", publisherNames: ["IndexArc"] };

  it("installs only on a signed, installed Windows build", () => {
    expect(updatePolicy(base)).toEqual({ canCheck: true, canInstall: true, reason: "" });
    expect(updatePolicy({ ...base, publisherNames: [] }).canInstall).toBe(false);
    expect(updatePolicy({ ...base, publisherNames: [] }).reason).toBe("unsigned");
    expect(updatePolicy({ ...base, isPortable: true }).reason).toBe("portable");
    expect(updatePolicy({ ...base, platform: "darwin" }).canInstall).toBe(false);
    expect(updatePolicy({ ...base, isPackaged: false }).canCheck).toBe(false);
  });

  it("reads publisherName from app-update.yml", () => {
    expect(parsePublisherNames("provider: github\nowner: Mubder\n")).toEqual([]);
    expect(parsePublisherNames("publisherName:\n  - IndexArc Ltd\n  - 'Other'\nowner: x")).toEqual(["IndexArc Ltd", "Other"]);
    expect(parsePublisherNames("publisherName: IndexArc\r\n")).toEqual(["IndexArc"]);
  });

  it("compares versions numerically", () => {
    expect(compareVersions("2.10.0", "2.9.9")).toBeGreaterThan(0);
    expect(compareVersions("v2.1.0", "2.1.0")).toBe(0);
    expect(compareVersions("2.0.9", "2.1.0")).toBeLessThan(0);
  });
});
