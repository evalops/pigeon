import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NonceStore, verifyDeviceRequest } from "./auth.js";
import { RelayClient } from "./client.js";

describe("relay client", () => {
  it("signs create commands without sending local paths", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519"); let verified = false; let sentBody: unknown;
    const client = new RelayClient({ baseUrl: "https://relay.example", deviceId: "device-1", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), clock: () => 1_000, nonce: () => "client-nonce-0001", request: async (url, init) => {
      sentBody = JSON.parse(String(init?.body)); const headers = new Headers(init?.headers); verifyDeviceRequest({ method: String(init?.method), path: new URL(String(url)).pathname, timestamp: Number(headers.get("x-pigeon-timestamp")), nonce: String(headers.get("x-pigeon-nonce")), signature: String(headers.get("x-pigeon-signature")), body: sentBody }, publicKey.export({ type: "spki", format: "pem" }).toString(), new NonceStore(), 1_000); verified = true;
      return new Response(JSON.stringify({ delegation: { id: "d1" } }), { status: 201, headers: { "content-type": "application/json" } });
    } });
    await client.createDelegation({ recipientId: "bob", objective: "Review", workspaceLabel: "pigeon", requestedScope: "read_only", idempotencyKey: "client-test-0001", expiresAt: 2_000 });
    expect(verified).toBe(true); expect(JSON.stringify(sentBody)).not.toContain("/Users/");
  });

  it("signs cursor reads and elevated approvals as Codex", async () => {
    const { privateKey } = generateKeyPairSync("ed25519"); const calls: string[] = []; const client = new RelayClient({ baseUrl: "https://relay.example", deviceId: "device-1", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), request: async url => { calls.push(String(url)); return new Response(JSON.stringify({ events: [] }), { headers: { "content-type": "application/json" } }); } });
    await client.events(42); expect(calls[0]).toContain("after=42");
  });
});
