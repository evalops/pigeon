import { describe, expect, it } from "vitest";
import { RemoteExecutionWorker } from "./execution-worker.js";

describe("remote execution worker", () => {
  it("executes an approved delegation once and reports its result", async () => {
    const completed: unknown[] = []; let state = "approved"; const delegation = () => ({ id: "d1", state, version: state === "approved" ? 2 : state === "running" ? 3 : 4, objective: "Discuss", workspaceLabel: "pigeon", effectiveScope: "discuss_only" as const }); const relay = { events: async () => ({ events: [{ delegationId: "d1" }] }), get: async () => ({ delegation: delegation() }), start: async () => { state = "running"; return { delegation: delegation() }; }, complete: async (_id: string, _version: number, result: unknown) => { completed.push(result); state = "completed"; return { delegation: delegation() }; }, fail: async () => { throw new Error("unexpected_failure"); } }; const adapter = { run: async () => ({ summary: "Finished", threadId: "thread-1" }) };
    const worker = new RemoteExecutionWorker(relay, adapter, () => process.cwd()); await worker.runApproved(); await worker.runApproved(); expect(completed).toEqual([{ summary: "Finished", threadId: "thread-1" }]);
  });
});
