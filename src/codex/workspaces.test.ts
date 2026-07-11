import { describe, expect, it } from "vitest";
import { resolveDelegationWorkspace } from "./workspaces.js";

describe("workspace resolution", () => {
  it("requires an explicit local mapping for workspace authority", () => {
    expect(resolveDelegationWorkspace("pigeon", "read_only", { pigeon: "/srv/pigeon" })).toBe("/srv/pigeon"); expect(() => resolveDelegationWorkspace("unknown", "workspace_write", {})).toThrow("workspace_not_configured");
  });
  it("does not expose a mapped workspace to discuss-only work", () => { expect(resolveDelegationWorkspace("pigeon", "discuss_only", { pigeon: "/srv/pigeon" })).toBe(process.cwd()); });
});
