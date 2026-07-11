import { describe, expect, it, vi } from "vitest";
import type { RunRecord, SubmitRequest } from "@evalops/agent-kit";
import { CapabilityStore, generateIdentity, signEnvelope, verifyEnvelope } from "./security.js";
import { Gateway, type AgentKitTransport } from "./gateway.js";

describe("security", () => {
  it("detects tampering and consumes confirmation once", () => {
    const identity = generateIdentity("alex");
    const signed = signEnvelope(identity, { hello: "bird" });
    expect(verifyEnvelope(identity.publicKey, signed)).toBe(true);
    expect(verifyEnvelope(identity.publicKey, { ...signed, payload: { hello: "cat" } })).toBe(false);
    const store = new CapabilityStore();
    const token = store.issue("d1", 1000);
    expect(store.consume(token, "d1")).toBe(true);
    expect(store.consume(token, "d1")).toBe(false);
  });
});

describe("Agent Kit gateway", () => {
  it("submits, reads inbox, narrows authority, and never runs Codex in Pigeon", async () => {
    const fake = new FakeAgentKit();
    const gateway = new Gateway(identity("jon"), fake);
    const delegation = await gateway.delegate("alex", "inspect tests", "github_repo:evalops/pigeon", "workspace_write");
    const recipient = new Gateway(identity("alex"), fake);
    expect(await recipient.inbox()).toHaveLength(1);
    const prepared = await recipient.prepareApproval(delegation.id, "read_only");
    expect(prepared.confirmation.effectiveScope).toBe("read_only");
    await recipient.confirmApproval(delegation.id, "read_only");
    expect((await recipient.get(delegation.id))?.effectiveScope).toBe("read_only");
    expect(fake.approve).toHaveBeenCalledTimes(1);
  });

  it("rejects widened authority before calling the daemon", async () => {
    const fake = new FakeAgentKit();
    const sender = new Gateway(identity("jon"), fake);
    const delegation = await sender.delegate("alex", "chat", "github_repo:evalops/pigeon", "read_only");
    const recipient = new Gateway(identity("alex"), fake);
    await expect(recipient.prepareApproval(delegation.id, "workspace_write")).rejects.toThrow("scope_widening");
    expect(fake.approve).not.toHaveBeenCalled();
  });
});

const identity = (userPrincipalId: string) => ({ organizationId: "org", workspaceId: "workspace", userPrincipalId, devicePrincipalId: `${userPrincipalId}-device` });

class FakeAgentKit implements AgentKitTransport {
  private runs = new Map<string, RunRecord>();
  approve = vi.fn(async (id: string, scope: "discuss_only" | "read_only" | "workspace_write") => {
    const run = await this.getRun(id); run.effective_scope = scope; return run;
  });
  async submit(request: SubmitRequest) { const run = { run_id: `run_${this.runs.size + 1}`, request, state: "queued" as const, events: [] }; this.runs.set(run.run_id, run); return run; }
  async inbox(recipient: string) { return [...this.runs.values()].filter(run => run.request.recipient_principal_id === recipient && !run.effective_scope); }
  async getRun(id: string) { const run = this.runs.get(id); if (!run) throw Object.assign(new Error("missing"), { code: "not_found" }); return run; }
  async reject(id: string) { const run = await this.getRun(id); run.state = "rejected"; return run; }
  async cancel(id: string) { const run = await this.getRun(id); run.state = "cancelled"; return run; }
}
