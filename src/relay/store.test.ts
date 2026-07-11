import { describe, expect, it } from "vitest";
import { MemoryRelayStore } from "./memory-store.js";

const actor = { organizationId: "acme", userId: "alice", deviceId: "alice-mac", source: "codex" as const };
const input = { recipientId: "bob", objective: "Review the rollout", workspaceLabel: "pigeon", requestedScope: "read_only" as const, idempotencyKey: "request-0001", expiresAt: 2_000 };

describe("relay store", () => {
  it("creates idempotently and exposes events only to the organization recipient", async () => {
    const store = new MemoryRelayStore(() => 1_000);
    const first = await store.createDelegation(input, actor);
    const second = await store.createDelegation(input, actor);
    expect(second.delegation.id).toBe(first.delegation.id);
    expect((await store.events("acme", "bob", 0)).map(event => event.delegationId)).toEqual([first.delegation.id]);
    expect(await store.events("other", "bob", 0)).toEqual([]);
    expect(await store.events("acme", "mallory", 0)).toEqual([]);
  });

  it("allows narrowing but rejects widening and stale versions", async () => {
    const store = new MemoryRelayStore(() => 1_000);
    const { delegation } = await store.createDelegation(input, actor);
    const approved = await store.transition(delegation.id, 1, { type: "approve", effectiveScope: "discuss_only" }, { ...actor, userId: "bob", deviceId: "bob-mac" });
    expect(approved.state).toBe("approved");
    expect(approved.effectiveScope).toBe("discuss_only");
    await expect(store.transition(delegation.id, 1, { type: "start" }, { ...actor, userId: "bob" })).rejects.toThrow("version_conflict");

    const second = await store.createDelegation({ ...input, idempotencyKey: "request-0002", requestedScope: "discuss_only" }, actor);
    await expect(store.transition(second.delegation.id, 1, { type: "approve", effectiveScope: "read_only" }, { ...actor, userId: "bob" })).rejects.toThrow("scope_widening");
  });

  it("enforces ownership, expiry, and terminal states", async () => {
    let now = 1_000;
    const store = new MemoryRelayStore(() => now);
    const { delegation } = await store.createDelegation(input, actor);
    await expect(store.transition(delegation.id, 1, { type: "reject" }, { ...actor, userId: "mallory" })).rejects.toThrow("not_found");
    now = 3_000;
    await expect(store.transition(delegation.id, 1, { type: "approve", effectiveScope: "read_only" }, { ...actor, userId: "bob" })).rejects.toThrow("expired");
  });

  it("rejects workspace labels that contain paths", async () => {
    const store = new MemoryRelayStore(() => 1_000);
    await expect(store.createDelegation({ ...input, workspaceLabel: "/Users/alice/secret" }, actor)).rejects.toThrow("invalid_workspace_label");
  });
});
