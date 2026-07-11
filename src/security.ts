import { createHash, generateKeyPairSync, randomBytes, sign, timingSafeEqual, verify } from "node:crypto";

export interface Identity { name: string; publicKey: string; privateKey: string }
export interface SignedEnvelope { payload: unknown; signature: string }
const canonical = (value: unknown) => Buffer.from(JSON.stringify(value));

export function generateIdentity(name: string): Identity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { name, publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(), privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}
export function signEnvelope(identity: Identity, payload: unknown): SignedEnvelope {
  return { payload, signature: sign(null, canonical(payload), identity.privateKey).toString("base64url") };
}
export function verifyEnvelope(publicKey: string, envelope: SignedEnvelope): boolean {
  return verify(null, canonical(envelope.payload), publicKey, Buffer.from(envelope.signature, "base64url"));
}

export class CapabilityStore {
  #tokens = new Map<string, { delegationId: string; expiresAt: number; consumed: boolean }>();
  issue(delegationId: string, ttlMs = 60_000): string {
    const raw = randomBytes(32).toString("base64url");
    this.#tokens.set(createHash("sha256").update(raw).digest("hex"), { delegationId, expiresAt: Date.now() + ttlMs, consumed: false });
    return raw;
  }
  consume(raw: string, delegationId: string): boolean {
    const digest = createHash("sha256").update(raw).digest();
    let found: string | undefined;
    for (const key of this.#tokens.keys()) if (timingSafeEqual(digest, Buffer.from(key, "hex"))) found = key;
    const entry = found ? this.#tokens.get(found) : undefined;
    if (!entry || entry.consumed || entry.expiresAt < Date.now() || entry.delegationId !== delegationId) return false;
    entry.consumed = true;
    return true;
  }
}
