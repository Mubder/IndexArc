import { describe, it, expect } from "vitest";
import { apiAuthMiddleware, getLastActivity } from "./auth.js";
import { throttle, recordFailure, recordSuccess } from "./routes/throttle.js";

// Auto-lock regression: every authenticated request used to count as "user
// activity", so the renderer's 30s/60s background polls kept an open window
// from EVER auto-locking. Only mutating requests and the explicit
// POST /api/activity ping may move the timer now.
function call(method: string, path: string): { status: number; nextCalled: boolean } {
  const req: any = {
    method,
    path,
    headers: { host: "127.0.0.1:3000", "x-indexarc-token": process.env.INDEXARC_API_TOKEN },
    header(name: string) {
      return this.headers[name.toLowerCase()];
    },
    query: {},
  };
  const out = { status: 200, nextCalled: false };
  const res: any = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json() {
      return this;
    },
    end() {
      return this;
    },
  };
  apiAuthMiddleware(req, res, () => {
    out.nextCalled = true;
  });
  return out;
}

const waitTick = () => new Promise((r) => setTimeout(r, 5));

describe("auto-lock activity tracking", () => {
  it("background GET polls do not count as activity", async () => {
    call("POST", "/entries/save");
    const before = getLastActivity();
    await waitTick();
    expect(call("GET", "/entries").nextCalled).toBe(true);
    expect(call("GET", "/health").nextCalled).toBe(true);
    expect(call("POST", "/sse/ticket").nextCalled).toBe(true);
    expect(getLastActivity()).toBe(before);
  });

  it("mutating requests and the activity ping do count", async () => {
    const t0 = getLastActivity();
    await waitTick();
    call("POST", "/scratchpad/tabs/x/content");
    const t1 = getLastActivity();
    expect(t1).toBeGreaterThan(t0);
    await waitTick();
    const ping = call("POST", "/activity");
    expect(ping.status).toBe(204);
    expect(ping.nextCalled).toBe(false);
    expect(getLastActivity()).toBeGreaterThan(t1);
  });

  it("requests without the token never count", async () => {
    const before = getLastActivity();
    await waitTick();
    const req: any = { method: "POST", path: "/entries/save", headers: { host: "127.0.0.1" }, header: () => "", query: {} };
    const res: any = { status: () => res, json: () => res };
    apiAuthMiddleware(req, res, () => {});
    expect(getLastActivity()).toBe(before);
  });
});

describe("password throttle", () => {
  const res: any = { status: () => res, json: () => res };
  const req = (ip: string): any => ({ ip });

  it("escalating delay persists until a verified success", () => {
    const r = req("10.0.0.1");
    throttle(r, res, { max: 10 });
    recordFailure(r);
    throttle(r, res, { max: 10 });
    recordFailure(r);
    expect(throttle(r, res, { max: 10 })?.delayMs).toBe(1000);
    recordSuccess(r);
    expect(throttle(r, res, { max: 10 })?.delayMs).toBe(0);
  });
});
