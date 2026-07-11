import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CodexAppServerAdapter } from "./app-server.js";

const fixture = resolve("src/codex/fixtures/fake-app-server.mjs");
describe("Codex app-server adapter", () => {
  it("starts an ephemeral read-only task in the approved workspace", async () => {
    const adapter = new CodexAppServerAdapter({ command: process.execPath, args: [fixture], timeoutMs: 5_000 }); const result = await adapter.run({ id: "d1", objective: "Review the repository", workspace: process.cwd(), scope: "read_only" });
    expect(result.threadId).toBe("thread-1"); expect(result.summary).toContain(`completed:read-only:${process.cwd()}:gpt-5.4`);
  });
  it("maps write scope to workspace-write and rejects relative workspaces", async () => {
    const adapter = new CodexAppServerAdapter({ command: process.execPath, args: [fixture], timeoutMs: 5_000 }); const result = await adapter.run({ id: "d2", objective: "Update docs", workspace: process.cwd(), scope: "workspace_write" }); expect(result.summary).toContain("completed:workspace-write"); await expect(adapter.run({ id: "d3", objective: "No", workspace: "relative", scope: "read_only" })).rejects.toThrow("invalid_workspace");
  });
});
