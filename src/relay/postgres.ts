import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import { canNarrowScope, transition as nextState } from "../protocol.js";
import type { RelayStore } from "./store.js";
import { ActorSchema, CreateDelegationInputSchema, RelayCommandSchema, type Actor, type CreateDelegationInput, type RelayCommand, type RelayDelegation, type RelayEvent } from "./types.js";

export async function migrate(pool: Pool) { const sql = await readFile(new URL("./migrations/001_relay.sql", import.meta.url), "utf8"); await pool.query(sql); }

const delegationFrom = (row: Record<string, unknown>): RelayDelegation => ({
  id: String(row.id), organizationId: String(row.organization_id), senderId: String(row.sender_id), recipientId: String(row.recipient_id),
  objective: String(row.objective), workspaceLabel: String(row.workspace_label), requestedScope: row.requested_scope as RelayDelegation["requestedScope"],
  ...(row.effective_scope ? { effectiveScope: row.effective_scope as RelayDelegation["requestedScope"] } : {}), state: row.state as RelayDelegation["state"],
  ...(row.result_summary ? { resultSummary: String(row.result_summary) } : {}), ...(row.codex_thread_id ? { codexThreadId: String(row.codex_thread_id) } : {}), version: Number(row.version), idempotencyKey: String(row.idempotency_key), expiresAt: Number(row.expires_at), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at)
});
const eventFrom = (row: Record<string, unknown>): RelayEvent => ({ sequence: Number(row.sequence), delegationId: String(row.delegation_id), organizationId: String(row.organization_id), recipientId: String(row.recipient_id), type: row.type as RelayEvent["type"], version: Number(row.version), actor: row.actor as Actor, createdAt: Number(row.created_at) });

export class PostgresRelayStore implements RelayStore {
  constructor(private readonly pool: Pool, private readonly clock: () => number = Date.now) {}

  async createDelegation(raw: CreateDelegationInput, rawActor: Actor) {
    const parsed = CreateDelegationInputSchema.safeParse(raw); if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "invalid_request");
    const input = parsed.data; const actor = ActorSchema.parse(rawActor); const now = this.clock(); if (input.expiresAt <= now) throw new Error("expired");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT * FROM delegations WHERE organization_id=$1 AND sender_id=$2 AND idempotency_key=$3", [actor.organizationId, actor.userId, input.idempotencyKey]);
      if (existing.rowCount) { const delegation = delegationFrom(existing.rows[0]); const event = eventFrom((await client.query("SELECT * FROM relay_events WHERE delegation_id=$1 ORDER BY sequence LIMIT 1", [delegation.id])).rows[0]); await client.query("COMMIT"); return { delegation, event }; }
      const id = randomUUID();
      const inserted = await client.query("INSERT INTO delegations(id,organization_id,sender_id,recipient_id,objective,workspace_label,requested_scope,state,version,idempotency_key,expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',1,$8,$9,$10,$10) RETURNING *", [id, actor.organizationId, actor.userId, input.recipientId, input.objective, input.workspaceLabel, input.requestedScope, input.idempotencyKey, input.expiresAt, now]);
      const event = await this.insertEvent(client, delegationFrom(inserted.rows[0]), "created", actor);
      await client.query("INSERT INTO relay_outbox(event_sequence,payload,available_at) VALUES($1,$2,$3)", [event.sequence, JSON.stringify(event), now]);
      await client.query("COMMIT"); return { delegation: delegationFrom(inserted.rows[0]), event };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async get(id: string, organizationId: string, userId: string) { const result = await this.pool.query("SELECT * FROM delegations WHERE id=$1 AND organization_id=$2 AND (sender_id=$3 OR recipient_id=$3)", [id, organizationId, userId]); return result.rowCount ? delegationFrom(result.rows[0]) : undefined; }
  async events(organizationId: string, recipientId: string, after: number) { const result = await this.pool.query("SELECT * FROM relay_events WHERE organization_id=$1 AND recipient_id=$2 AND sequence>$3 ORDER BY sequence LIMIT 200", [organizationId, recipientId, after]); return result.rows.map(eventFrom); }

  async transition(id: string, expectedVersion: number, raw: RelayCommand, rawActor: Actor) {
    const command = RelayCommandSchema.parse(raw); const actor = ActorSchema.parse(rawActor); const client = await this.pool.connect();
    try {
      await client.query("BEGIN"); const selected = await client.query("SELECT * FROM delegations WHERE id=$1 FOR UPDATE", [id]);
      if (!selected.rowCount) throw new Error("not_found"); const current = delegationFrom(selected.rows[0]);
      if (current.organizationId !== actor.organizationId || current.recipientId !== actor.userId) throw new Error("not_found");
      if (current.expiresAt < this.clock() && current.state === "pending") throw new Error("expired"); if (current.version !== expectedVersion) throw new Error("version_conflict");
      let effectiveScope = current.effectiveScope; if (command.type === "approve") { if (!canNarrowScope(current.requestedScope, command.effectiveScope)) throw new Error("scope_widening"); effectiveScope = command.effectiveScope; }
      const state = nextState(current.state, command.type); const updated = await client.query("UPDATE delegations SET state=$2,effective_scope=$3,version=version+1,updated_at=$4,result_summary=COALESCE($5,result_summary),codex_thread_id=COALESCE($6,codex_thread_id) WHERE id=$1 RETURNING *", [id, state, effectiveScope ?? null, this.clock(), command.type === "complete" ? command.summary ?? null : null, command.type === "complete" ? command.threadId ?? null : null]);
      const delegation = delegationFrom(updated.rows[0]); const event = await this.insertEvent(client, delegation, command.type, actor);
      await client.query("INSERT INTO relay_outbox(event_sequence,payload,available_at) VALUES($1,$2,$3)", [event.sequence, JSON.stringify(event), this.clock()]); await client.query("COMMIT"); return delegation;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async claimOutbox(limit: number) { const result = await this.pool.query("UPDATE relay_outbox SET claimed_at=$2,attempts=attempts+1 WHERE id IN (SELECT id FROM relay_outbox WHERE completed_at IS NULL AND claimed_at IS NULL AND available_at<=$2 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1) RETURNING id,payload,attempts", [limit, this.clock()]); return result.rows as Array<{ id: number; payload: RelayEvent; attempts: number }>; }
  async completeOutbox(id: number) { await this.pool.query("UPDATE relay_outbox SET completed_at=$2 WHERE id=$1", [id, this.clock()]); }
  async failOutbox(id: number, error: string) { await this.pool.query("UPDATE relay_outbox SET claimed_at=NULL,last_error=$2,available_at=$3 WHERE id=$1", [id, error.slice(0, 500), this.clock() + 1_000]); }
  private async insertEvent(client: PoolClient, delegation: RelayDelegation, type: RelayEvent["type"], actor: Actor) { const result = await client.query("INSERT INTO relay_events(delegation_id,organization_id,recipient_id,type,version,actor,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *", [delegation.id, delegation.organizationId, delegation.recipientId, type, delegation.version, JSON.stringify(actor), this.clock()]); return eventFrom(result.rows[0]); }
}
