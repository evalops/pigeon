import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalRequest, NonceStore, verifyDeviceRequest } from "./auth.js";

describe("device authentication", () => {
  it("verifies a signed request once and rejects replay", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519"); const nonces = new NonceStore(); const now = 10_000;
    const request = { method: "POST", path: "/v1/delegations", timestamp: now, nonce: "nonce-0001", body: { objective: "Review" } };
    const signature = sign(null, Buffer.from(canonicalRequest(request)), privateKey).toString("base64");
    expect(verifyDeviceRequest({ ...request, signature }, publicKey.export({ type: "spki", format: "pem" }).toString(), nonces, now)).toBe(true);
    expect(() => verifyDeviceRequest({ ...request, signature }, publicKey.export({ type: "spki", format: "pem" }).toString(), nonces, now)).toThrow("replay");
  });

  it("rejects stale timestamps and modified bodies", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519"); const request = { method: "POST", path: "/x", timestamp: 1_000, nonce: "nonce-0002", body: { value: 1 } };
    const signature = sign(null, Buffer.from(canonicalRequest(request)), privateKey).toString("base64");
    expect(() => verifyDeviceRequest({ ...request, signature }, publicKey.export({ type: "spki", format: "pem" }).toString(), new NonceStore(), 1_000_000)).toThrow("stale_request");
    expect(() => verifyDeviceRequest({ ...request, body: { value: 2 }, signature }, publicKey.export({ type: "spki", format: "pem" }).toString(), new NonceStore(), 1_000)).toThrow("invalid_signature");
  });
});
