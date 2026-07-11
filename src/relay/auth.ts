import { createHash, createPublicKey, verify } from "node:crypto";

type CanonicalInput = { method: string; path: string; timestamp: number; nonce: string; body: unknown };
export function canonicalRequest(input: CanonicalInput) { const digest = createHash("sha256").update(JSON.stringify(input.body ?? null)).digest("hex"); return `${input.timestamp}\n${input.nonce}\n${input.method.toUpperCase()}\n${input.path}\n${digest}`; }

export class NonceStore {
  #seen = new Map<string, number>();
  consume(nonce: string, now: number) { for (const [key, expiry] of this.#seen) if (expiry < now) this.#seen.delete(key); if (this.#seen.has(nonce)) throw new Error("replay"); this.#seen.set(nonce, now + 5 * 60_000); }
}

export function verifyDeviceRequest(input: CanonicalInput & { signature: string }, publicKey: string, nonces: NonceStore, now = Date.now()) {
  if (Math.abs(now - input.timestamp) > 5 * 60_000) throw new Error("stale_request");
  const valid = verify(null, Buffer.from(canonicalRequest(input)), createPublicKey(publicKey), Buffer.from(input.signature, "base64"));
  if (!valid) throw new Error("invalid_signature"); nonces.consume(input.nonce, now); return true;
}
