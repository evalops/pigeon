import { randomUUID } from "node:crypto";
import type { AuthorityScope, RunRecord, SubmitRequest } from "@evalops/agent-kit";
import { canNarrowScope, type Delegation, type Scope } from "./protocol.js";

export interface AgentKitTransport {
  submit(request: SubmitRequest): Promise<RunRecord>;
  inbox(recipientPrincipalId: string): Promise<RunRecord[]>;
  getRun(runId: string): Promise<RunRecord>;
  approve(runId: string, scope: AuthorityScope): Promise<RunRecord>;
  reject(runId: string, reason: string): Promise<RunRecord>;
  cancel(runId: string, reason: string): Promise<RunRecord>;
}

export interface GatewayIdentity {
  organizationId: string;
  workspaceId: string;
  userPrincipalId: string;
  devicePrincipalId: string;
}

export class Gateway {
  constructor(private readonly identity: GatewayIdentity, private readonly client: AgentKitTransport) {}

  async delegate(recipient: string, objective: string, resourceId: string, requestedScope: Scope): Promise<Delegation> {
    const run = await this.client.submit({
      organization_id: this.identity.organizationId,
      workspace_id: this.identity.workspaceId,
      sender_principal_id: this.identity.userPrincipalId,
      recipient_principal_id: recipient,
      target_capability: "codex.app-server",
      resource_id: resourceId,
      objective,
      requested_scope: requestedScope,
      idempotency_key: `pigeon:${randomUUID()}`,
    });
    return project(run);
  }

  async inbox(): Promise<Delegation[]> {
    return (await this.client.inbox(this.identity.userPrincipalId)).map(project);
  }

  async get(id: string): Promise<Delegation | undefined> {
    try { return project(await this.client.getRun(id)); }
    catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async prepareApproval(id: string, effectiveScope: Scope) {
    const delegation = await this.mustOwn(id);
    if (!canNarrowScope(delegation.requestedScope, effectiveScope)) throw new Error("scope_widening");
    return { confirmation: { sender: delegation.sender, objective: delegation.objective, workspace: delegation.workspace, effectiveScope } };
  }

  async confirmApproval(id: string, effectiveScope: Scope): Promise<Delegation> {
    await this.mustOwn(id);
    return project(await this.client.approve(id, effectiveScope));
  }

  async reject(id: string, reason = "recipient rejected"): Promise<Delegation> {
    await this.mustOwn(id);
    return project(await this.client.reject(id, reason));
  }

  async cancel(id: string, reason = "sender cancelled"): Promise<Delegation> {
    return project(await this.client.cancel(id, reason));
  }

  private async mustOwn(id: string): Promise<Delegation> {
    const delegation = await this.get(id);
    if (!delegation || delegation.recipient !== this.identity.userPrincipalId) throw new Error("not_found");
    return delegation;
  }
}

function project(run: RunRecord): Delegation {
  const state = run.state === "queued" ? (run.effective_scope ? "approved" : "pending") : run.state;
  return {
    id: run.run_id,
    sender: run.request.sender_principal_id,
    recipient: run.request.recipient_principal_id,
    objective: run.request.objective,
    workspace: run.request.resource_id,
    requestedScope: run.request.requested_scope,
    effectiveScope: run.effective_scope,
    state,
    createdAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    idempotencyKey: run.request.idempotency_key,
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "not_found";
}
