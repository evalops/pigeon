import { describe, expect, it } from "vitest";
import { deliverOutboxOnce } from "./worker.js";

describe("Slack outbox worker", () => {
  it("delivers created delegations and completes the item", async () => {
    const completed: number[] = []; const notices: unknown[] = []; const store = {
      claimOutbox: async () => [{ id: 7, attempts: 1, payload: { sequence: 1, type: "created" as const, delegationId: "d1", organizationId: "acme", recipientId: "U2", version: 1, actor: { organizationId: "acme", userId: "alice", deviceId: "d1", source: "codex" as const }, createdAt: 1_000 } }],
      get: async () => ({ id: "d1", organizationId: "acme", senderId: "alice", recipientId: "U2", objective: "Review", workspaceLabel: "pigeon", requestedScope: "read_only" as const, state: "pending" as const, version: 1, idempotencyKey: "worker-test-0001", expiresAt: 2_000, createdAt: 1_000, updatedAt: 1_000 }),
      completeOutbox: async (id: number) => { completed.push(id); }, failOutbox: async () => { throw new Error("unexpected_failure"); }
    }; const slack = { postDelegation: async (notice: unknown) => { notices.push(notice); return { ok: true }; } };
    await deliverOutboxOnce(store, slack); expect(notices).toHaveLength(1); expect(completed).toEqual([7]);
  });
});
