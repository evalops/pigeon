import { describe, expect, it, vi } from "vitest";
import { CapabilityStore, generateIdentity, signEnvelope, verifyEnvelope } from "./security.js";
import { Gateway, InMemoryRelay } from "./gateway.js";

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

describe("gateway", () => {
  it("requires confirmation, narrows authority, and runs exactly once", async () => {
    const relay = new InMemoryRelay();
    const run = vi.fn(async () => ({ summary: "done" }));
    const a = new Gateway("jon", relay, { run });
    const b = new Gateway("alex", relay, { run });
    const delegation = a.delegate("alex", "inspect tests", "/repo", "workspace_write");
    expect(b.inbox()).toHaveLength(1);
    const prepared = b.prepareApproval(delegation.id, "read_only");
    await b.confirmApproval(delegation.id, prepared.capability);
    await expect(b.confirmApproval(delegation.id, prepared.capability)).rejects.toThrow("invalid_confirmation");
    expect(run).toHaveBeenCalledTimes(1);
    expect(b.get(delegation.id)?.effectiveScope).toBe("read_only");
  });

  it("rejects widened authority", () => {
    const relay = new InMemoryRelay();
    const b = new Gateway("alex", relay, { run: async () => ({ summary: "" }) });
    const a = new Gateway("jon", relay, { run: async () => ({ summary: "" }) });
    const delegation = a.delegate("alex", "chat", "/repo", "read_only");
    expect(() => b.prepareApproval(delegation.id, "workspace_write")).toThrow("scope_widening");
  });
});
