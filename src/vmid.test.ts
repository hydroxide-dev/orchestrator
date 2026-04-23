import { describe, expect, test } from "bun:test";
import { lowestAvailableVmid } from "./vmid";
import { quoteShell } from "./ssh";

describe("lowestAvailableVmid", () => {
  test("returns 100 when no vmids are used", () => {
    expect(lowestAvailableVmid([])).toBe(100);
  });

  test("skips occupied ids and finds the first gap", () => {
    expect(lowestAvailableVmid([100, 101, 103, 120])).toBe(102);
  });

  test("ignores values below the floor", () => {
    expect(lowestAvailableVmid([1, 2, 99, 100])).toBe(101);
  });
});

describe("quoteShell", () => {
  test("escapes single quotes", () => {
    expect(quoteShell("can't fail")).toBe("'can'\"'\"'t fail'");
  });
});
