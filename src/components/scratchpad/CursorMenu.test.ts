import { describe, expect, it } from "vitest";
import { placeMenu } from "./CursorMenu";

describe("placeMenu", () => {
  const W = 256, H = 300, VW = 1200, VH = 800;

  it("opens at the cursor when it fits", () => {
    expect(placeMenu(100, 100, W, H, VW, VH)).toEqual({ left: 100, top: 100 });
  });

  it("flips left of the cursor near the right edge", () => {
    expect(placeMenu(1100, 100, W, H, VW, VH)).toEqual({ left: 1100 - W, top: 100 });
  });

  it("flips above the cursor near the bottom edge", () => {
    expect(placeMenu(100, 700, W, H, VW, VH)).toEqual({ left: 100, top: 700 - H });
  });

  it("flips both ways in the bottom-right corner", () => {
    expect(placeMenu(1150, 780, W, H, VW, VH)).toEqual({ left: 1150 - W, top: 780 - H });
  });

  it("stays inside a viewport smaller than the flip room", () => {
    const p = placeMenu(150, 200, W, H, 400, 350);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.left + W).toBeLessThanOrEqual(400 - 8);
    expect(p.top + H).toBeLessThanOrEqual(350 - 8);
  });

  it("pins to the top-left margin when the menu is larger than the window", () => {
    expect(placeMenu(50, 50, 500, 900, 400, 600)).toEqual({ left: 8, top: 8 });
  });
});
