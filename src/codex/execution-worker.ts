import type { Scope } from "../protocol.js";

type Delegation = { id: string; state: string; version: number; objective: string; workspaceLabel: string; effectiveScope?: Scope; resultSummary?: string; codexThreadId?: string };
type Relay = { events(after?: number): Promise<{ events: Array<{ delegationId: string }> }>; get(id: string): Promise<{ delegation: Delegation }>; start(id: string, version: number): Promise<{ delegation: Delegation }>; complete(id: string, version: number, result: { summary: string; threadId: string }): Promise<{ delegation: Delegation }>; fail(id: string, version: number): Promise<unknown> };
type Adapter = { run(input: { id: string; objective: string; workspace: string; scope: Scope }): Promise<{ summary: string; threadId: string }> };

export class RemoteExecutionWorker {
  #active = new Set<string>();
  constructor(private readonly relay: Relay, private readonly adapter: Adapter, private readonly resolveWorkspace: (label: string, scope: Scope) => string) {}
  async runApproved() { const events = await this.relay.events(0); const ids = [...new Set(events.events.map(event => event.delegationId))]; for (const id of ids) { const delegation = (await this.relay.get(id)).delegation; if (delegation.state === "approved") await this.execute(delegation); } }
  async execute(delegation: Delegation) {
    if (this.#active.has(delegation.id) || delegation.state !== "approved") return delegation; this.#active.add(delegation.id);
    try { const scope = delegation.effectiveScope; if (!scope) throw new Error("missing_effective_scope"); let running = (await this.relay.start(delegation.id, delegation.version)).delegation; try { const result = await this.adapter.run({ id: delegation.id, objective: delegation.objective, workspace: this.resolveWorkspace(delegation.workspaceLabel, scope), scope }); return (await this.relay.complete(delegation.id, running.version, result)).delegation; } catch (error) { await this.relay.fail(delegation.id, running.version); throw error; } } finally { this.#active.delete(delegation.id); }
  }
}
