import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate, PostgresRelayStore } from "./postgres.js";

const url = process.env.PIGEON_TEST_DATABASE_URL;
describe.skipIf(!url)("postgres relay store", () => {
  const pool = new Pool({ connectionString: url });
  const store = new PostgresRelayStore(pool, () => 1_000);
  const actor = { organizationId: "acme", userId: "alice", deviceId: "alice-mac", source: "codex" as const };

  beforeAll(async () => { await migrate(pool); await pool.query("TRUNCATE relay_outbox, relay_events, delegations RESTART IDENTITY CASCADE"); });
  afterAll(async () => pool.end());

  it("atomically creates one delegation, event, and outbox item", async () => {
    const input = { recipientId: "bob", objective: "Review release", workspaceLabel: "pigeon", requestedScope: "read_only" as const, idempotencyKey: "postgres-0001", expiresAt: 2_000 };
    const first = await store.createDelegation(input, actor); const second = await store.createDelegation(input, actor);
    expect(second.delegation.id).toBe(first.delegation.id);
    expect((await pool.query("SELECT count(*)::int AS count FROM delegations")).rows[0].count).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM relay_events")).rows[0].count).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM relay_outbox")).rows[0].count).toBe(1);
  });

  it("uses row versions and exposes cursor-ordered recipient events", async () => {
    const created = await store.createDelegation({ recipientId: "bob", objective: "Discuss release", workspaceLabel: "pigeon", requestedScope: "discuss_only", idempotencyKey: "postgres-0002", expiresAt: 2_000 }, actor);
    const approved = await store.transition(created.delegation.id, 1, { type: "approve", effectiveScope: "discuss_only" }, { ...actor, userId: "bob", deviceId: "bob-mac" });
    expect(approved.version).toBe(2);
    await expect(store.transition(created.delegation.id, 1, { type: "start" }, { ...actor, userId: "bob" })).rejects.toThrow("version_conflict");
    const events = await store.events("acme", "bob", created.event.sequence);
    expect(events.some(event => event.type === "approve")).toBe(true);
  });

  it("claims and completes outbox work without double claiming", async () => {
    const first = await store.claimOutbox(1); const second = await store.claimOutbox(1);
    expect(first).toHaveLength(1); expect(second.map(item => item.id)).not.toContain(first[0]!.id);
    await store.completeOutbox(first[0]!.id);
  });
});
