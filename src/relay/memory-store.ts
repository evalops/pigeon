import { randomUUID } from "node:crypto";
import { canNarrowScope, transition as nextState } from "../protocol.js";
import type { RelayStore } from "./store.js";
import { ActorSchema, CreateDelegationInputSchema, RelayCommandSchema, type Actor, type CreateDelegationInput, type CreateResult, type RelayCommand, type RelayDelegation, type RelayEvent } from "./types.js";

export class MemoryRelayStore implements RelayStore {
  #delegations = new Map<string, RelayDelegation>();
  #events: RelayEvent[] = [];
  #idempotency = new Map<string, string>();
  constructor(private readonly clock: () => number = Date.now) {}

  async createDelegation(raw: CreateDelegationInput, rawActor: Actor): Promise<CreateResult> {
    const parsed = CreateDelegationInputSchema.safeParse(raw);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "invalid_request");
    const actor = ActorSchema.parse(rawActor);
    const key = `${actor.organizationId}:${actor.userId}:${parsed.data.idempotencyKey}`;
    const existingId = this.#idempotency.get(key);
    if (existingId) {
      const delegation = this.#delegations.get(existingId)!;
      return { delegation: structuredClone(delegation), event: structuredClone(this.#events.find(event => event.delegationId === existingId)!) };
    }
    const now = this.clock();
    if (parsed.data.expiresAt <= now) throw new Error("expired");
    const delegation: RelayDelegation = { ...parsed.data, id: randomUUID(), organizationId: actor.organizationId, senderId: actor.userId, state: "pending", version: 1, createdAt: now, updatedAt: now };
    this.#delegations.set(delegation.id, delegation); this.#idempotency.set(key, delegation.id);
    const event = this.#record(delegation, "created", actor);
    return { delegation: structuredClone(delegation), event: structuredClone(event) };
  }

  async get(id: string, organizationId: string, userId: string) {
    const delegation = this.#delegations.get(id);
    return delegation && delegation.organizationId === organizationId && (delegation.recipientId === userId || delegation.senderId === userId) ? structuredClone(delegation) : undefined;
  }

  async events(organizationId: string, recipientId: string, after: number) {
    return this.#events.filter(event => event.organizationId === organizationId && event.recipientId === recipientId && event.sequence > after).map(event => structuredClone(event));
  }

  async transition(id: string, expectedVersion: number, raw: RelayCommand, rawActor: Actor) {
    const command = RelayCommandSchema.parse(raw); const actor = ActorSchema.parse(rawActor); const current = this.#delegations.get(id);
    if (!current || current.organizationId !== actor.organizationId || current.recipientId !== actor.userId) throw new Error("not_found");
    if (current.expiresAt < this.clock() && current.state === "pending") throw new Error("expired");
    if (current.version !== expectedVersion) throw new Error("version_conflict");
    if (command.type === "approve") {
      if (!canNarrowScope(current.requestedScope, command.effectiveScope)) throw new Error("scope_widening");
      current.effectiveScope = command.effectiveScope;
    }
    current.state = nextState(current.state, command.type); current.version += 1; current.updatedAt = this.clock();
    this.#record(current, command.type, actor); return structuredClone(current);
  }

  #record(delegation: RelayDelegation, type: RelayEvent["type"], actor: Actor) {
    const event: RelayEvent = { sequence: this.#events.length + 1, delegationId: delegation.id, organizationId: delegation.organizationId, recipientId: delegation.recipientId, type, version: delegation.version, actor, createdAt: this.clock() };
    this.#events.push(event); return event;
  }
}
