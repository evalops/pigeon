import { generateKeyPairSync } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRelayApp } from "../relay/app.js";
import { migrate, PostgresRelayStore } from "../relay/postgres.js";
import type { DeviceIdentity } from "../relay/types.js";
import { EnrollmentService } from "./service.js";

const url = process.env.PIGEON_TEST_DATABASE_URL;
describe.skipIf(!url)("enrollment HTTP flow", () => {
  const pool = new Pool({ connectionString: url }); const devices = new Map<string, DeviceIdentity>();
  beforeAll(async () => { await migrate(pool); await pool.query("TRUNCATE enrollment_sessions, devices, relay_outbox, relay_events, delegations RESTART IDENTITY CASCADE"); }); afterAll(async () => pool.end());
  it("starts Slack OIDC and registers the public device on callback", async () => {
    const enrollment = new EnrollmentService(pool, () => 1_000); const oidc = { authorizationUrl: ({ state }: { state: string }) => new URL(`https://slack.example/authorize?state=${state}`), exchange: async () => ({ teamId: "T1", userId: "U1" }) };
    const app = createRelayApp({ store: new PostgresRelayStore(pool), devices, enrollment, oidc }); const server = app.listen(0); await new Promise<void>(resolve => server.once("listening", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("listen_failed"); const base = `http://127.0.0.1:${address.port}`;
    const { publicKey } = generateKeyPairSync("ed25519"); const started = await fetch(`${base}/v1/enrollment/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId: "alice-device", publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(), redirectUri: `${base}/v1/enrollment/callback` }) }); expect(started.status).toBe(201); const { authorizeUrl } = await started.json() as { authorizeUrl: string }; const state = new URL(authorizeUrl).searchParams.get("state")!;
    const completed = await fetch(`${base}/v1/enrollment/callback?state=${encodeURIComponent(state)}&code=code`, { redirect: "manual" }); expect(completed.status).toBe(200); expect(devices.get("alice-device")).toMatchObject({ organizationId: "T1", userId: "U1" }); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
});
