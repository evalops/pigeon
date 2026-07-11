import { generateKeyPairSync } from "node:crypto";
import { Pool } from "pg";
import { createRelayApp } from "../dist/relay/app.js";
import { RelayClient } from "../dist/relay/client.js";
import { migrate, PostgresRelayStore } from "../dist/relay/postgres.js";

const databaseUrl = process.env.PIGEON_SMOKE_DATABASE_URL;
if (!databaseUrl) throw new Error("PIGEON_SMOKE_DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl }); await migrate(pool); await pool.query("TRUNCATE relay_outbox, relay_events, delegations RESTART IDENTITY CASCADE");
const identity = name => { const pair = generateKeyPairSync("ed25519"); return { device: { id: `${name}-device`, organizationId: "smoke-org", userId: name, publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString() }, privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString() }; };
const alice = identity("alice"); const bob = identity("bob"); const devices = new Map([[alice.device.id, alice.device], [bob.device.id, bob.device]]); const app = createRelayApp({ store: new PostgresRelayStore(pool), devices }); const server = app.listen(0); await new Promise(resolve => server.once("listening", resolve));
try {
  const address = server.address(); if (!address || typeof address === "string") throw new Error("listen_failed"); const baseUrl = `http://127.0.0.1:${address.port}`; const a = new RelayClient({ baseUrl, deviceId: alice.device.id, privateKey: alice.privateKey }); const b = new RelayClient({ baseUrl, deviceId: bob.device.id, privateKey: bob.privateKey });
  let d = (await a.createDelegation({ recipientId: "bob", objective: "Smoke test the relay", workspaceLabel: "pigeon", requestedScope: "read_only", idempotencyKey: "smoke-request-0001", expiresAt: Date.now() + 60_000 })).delegation;
  if (!(await b.events(0)).events.some(event => event.delegationId === d.id)) throw new Error("delivery_failed"); d = (await b.approve(d.id, d.version, "discuss_only")).delegation; d = (await b.start(d.id, d.version)).delegation; d = (await b.complete(d.id, d.version)).delegation; if (d.state !== "completed") throw new Error("completion_failed"); process.stdout.write(`relay smoke passed: ${d.id}\n`);
} finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await pool.end(); }
