import { describe, expect, it } from "vitest";
import { canNarrowScope, transition } from "./protocol.js";

describe("delegation authority", () => {
  it("allows narrowing but never widening", () => {
    expect(canNarrowScope("workspace_write", "read_only")).toBe(true);
    expect(canNarrowScope("read_only", "workspace_write")).toBe(false);
  });

  it("enforces the approval lifecycle", () => {
    expect(transition("pending", "approve")).toBe("approved");
    expect(transition("approved", "start")).toBe("running");
    expect(() => transition("rejected", "start")).toThrow("invalid_transition");
  });
});
