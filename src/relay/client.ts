import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { canonicalRequest } from "./auth.js";
import type { CreateDelegationInput, RelayDelegation, RelayEvent } from "./types.js";

type Options = { baseUrl: string; deviceId: string; privateKey: string; request?: typeof fetch; clock?: () => number; nonce?: () => string };

export class RelayClient {
  private readonly request: typeof fetch; private readonly clock: () => number; private readonly nonce: () => string;
  constructor(private readonly options: Options) { this.request = options.request ?? fetch; this.clock = options.clock ?? Date.now; this.nonce = options.nonce ?? randomUUID; }
  createDelegation(input: CreateDelegationInput) { return this.call<{ delegation: RelayDelegation }>("POST", "/v1/delegations", input); }
  get(id: string) { return this.call<{ delegation: RelayDelegation }>("GET", `/v1/delegations/${encodeURIComponent(id)}`, null); }
  events(after = 0) { return this.call<{ events: RelayEvent[] }>("GET", `/v1/events?after=${after}`, null); }
  approve(id: string, expectedVersion: number, effectiveScope: RelayDelegation["requestedScope"]) { return this.call<{ delegation: RelayDelegation }>("POST", `/v1/delegations/${encodeURIComponent(id)}/approve`, { expectedVersion, effectiveScope }); }
  reject(id: string, expectedVersion: number) { return this.call<{ delegation: RelayDelegation }>("POST", `/v1/delegations/${encodeURIComponent(id)}/reject`, { expectedVersion }); }
  start(id: string, expectedVersion: number) { return this.call<{ delegation: RelayDelegation }>("POST", `/v1/delegations/${encodeURIComponent(id)}/start`, { expectedVersion }); }
  complete(id: string, expectedVersion: number, result?: { summary: string; threadId: string }) { return this.call<{ delegation: RelayDelegation }>("POST", `/v1/delegations/${encodeURIComponent(id)}/complete`, { expectedVersion, ...result }); }
  fail(id: string, expectedVersion: number) { return this.call<{ delegation: RelayDelegation }>("POST", `/v1/delegations/${encodeURIComponent(id)}/fail`, { expectedVersion }); }

  private async call<T>(method: string, relative: string, body: unknown): Promise<T> {
    const url = new URL(relative, this.options.baseUrl); const timestamp = this.clock(); const nonce = this.nonce(); const path = `${url.pathname}${url.search}`;
    const signature = sign(null, Buffer.from(canonicalRequest({ method, path, timestamp, nonce, body })), createPrivateKey(this.options.privateKey)).toString("base64");
    const response = await this.request(url, { method, headers: { ...(body === null ? {} : { "content-type": "application/json" }), "x-pigeon-device": this.options.deviceId, "x-pigeon-timestamp": String(timestamp), "x-pigeon-nonce": nonce, "x-pigeon-signature": signature }, ...(body === null ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as T & { error?: { code: string } }; if (!response.ok) throw new Error(result.error?.code ?? `relay_http_${response.status}`); return result;
  }
}
