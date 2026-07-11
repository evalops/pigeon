import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRelayStore } from "./memory-store.js";
import { createRelayApp } from "./app.js";
import { canonicalRequest } from "./auth.js";

describe("relay api", () => {
  it("creates and reads a signed delegation, then restricts Slack approval", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519"); const devices = new Map([["alice-mac", { id: "alice-mac", organizationId: "acme", userId: "alice", publicKey: publicKey.export({ type: "spki", format: "pem" }).toString() }]]);
    const app = createRelayApp({ store: new MemoryRelayStore(() => 1_000), devices, clock: () => 1_000, slackInternalSecret: "test-slack-secret" });
    const server = app.listen(0); await new Promise<void>(resolve => server.once("listening", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("listen_failed"); const base = `http://127.0.0.1:${address.port}`;
    const body = { recipientId: "bob", objective: "Review", workspaceLabel: "pigeon", requestedScope: "read_only", idempotencyKey: "api-test-0001", expiresAt: 2_000 };
    const timestamp = 1_000; const nonce = "api-nonce-0001"; const signature = sign(null, Buffer.from(canonicalRequest({ method: "POST", path: "/v1/delegations", timestamp, nonce, body })), privateKey).toString("base64");
    const created = await fetch(`${base}/v1/delegations`, { method: "POST", headers: { "content-type": "application/json", "x-pigeon-device": "alice-mac", "x-pigeon-timestamp": String(timestamp), "x-pigeon-nonce": nonce, "x-pigeon-signature": signature }, body: JSON.stringify(body) });
    expect(created.status).toBe(201); const payload = await created.json() as { delegation: { id: string; version: number; workspaceLabel: string } }; expect(payload.delegation.workspaceLabel).toBe("pigeon");
    const denied = await fetch(`${base}/v1/delegations/${payload.delegation.id}/approve`, { method: "POST", headers: { "content-type": "application/json", "x-pigeon-slack-secret": "test-slack-secret", "x-pigeon-slack-user": "bob", "x-pigeon-organization": "acme" }, body: JSON.stringify({ expectedVersion: 1, effectiveScope: "read_only" }) });
    expect(denied.status).toBe(403); expect(await denied.json()).toMatchObject({ error: { code: "codex_confirmation_required" } });
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
});
