import { randomUUID } from "node:crypto";
import { canNarrowScope, type Delegation, type Scope, transition } from "./protocol.js";
import { CapabilityStore } from "./security.js";

export interface CodexAdapter { run(delegation: Delegation, signal?: AbortSignal): Promise<{ summary: string }> }

export class InMemoryRelay {
  #events: Delegation[] = [];
  publish(d: Delegation) { const i = this.#events.findIndex(x => x.id === d.id); if (i >= 0) this.#events[i] = structuredClone(d); else this.#events.push(structuredClone(d)); }
  forRecipient(name: string) { return this.#events.filter(x => x.recipient === name).map(x => structuredClone(x)); }
  get(id: string) { const d = this.#events.find(x => x.id === id); return d && structuredClone(d); }
}

export class Gateway {
  #caps = new CapabilityStore();
  constructor(public readonly name: string, private relay: InMemoryRelay, private adapter: CodexAdapter) {}
  delegate(recipient: string, objective: string, workspace: string, requestedScope: Scope): Delegation {
    const now = Date.now();
    const d: Delegation = { id: randomUUID(), sender: this.name, recipient, objective, workspace, requestedScope, state: "pending", createdAt: now, expiresAt: now + 15 * 60_000, idempotencyKey: randomUUID() };
    this.relay.publish(d); return d;
  }
  inbox() { return this.relay.forRecipient(this.name).filter(d => d.state === "pending"); }
  get(id: string) { return this.relay.get(id); }
  prepareApproval(id: string, effectiveScope: Scope) {
    const d = this.mustOwn(id); if (!canNarrowScope(d.requestedScope, effectiveScope)) throw new Error("scope_widening");
    d.effectiveScope = effectiveScope; this.relay.publish(d);
    return { capability: this.#caps.issue(id), confirmation: { sender: d.sender, objective: d.objective, workspace: d.workspace, effectiveScope } };
  }
  async confirmApproval(id: string, capability: string) {
    if (!this.#caps.consume(capability, id)) throw new Error("invalid_confirmation");
    const d = this.mustOwn(id); d.state = transition(d.state, "approve"); d.state = transition(d.state, "start"); this.relay.publish(d);
    try { const result = await this.adapter.run(d); d.state = transition(d.state, "complete"); this.relay.publish(d); return result; }
    catch (error) { d.state = transition(d.state, "fail"); this.relay.publish(d); throw error; }
  }
  reject(id: string) { const d = this.mustOwn(id); d.state = transition(d.state, "reject"); this.relay.publish(d); }
  private mustOwn(id: string) { const d = this.relay.get(id); if (!d || d.recipient !== this.name) throw new Error("not_found"); if (d.expiresAt < Date.now()) throw new Error("expired"); return d; }
}
