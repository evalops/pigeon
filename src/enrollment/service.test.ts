import { generateKeyPairSync } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../relay/postgres.js";
import { EnrollmentService } from "./service.js";

const url = process.env.PIGEON_TEST_DATABASE_URL;
describe.skipIf(!url)("device enrollment", () => {
  const pool = new Pool({ connectionString: url }); let now = 1_000; const service = new EnrollmentService(pool, () => now);
  beforeAll(async () => { await migrate(pool); await pool.query("TRUNCATE enrollment_sessions, devices, relay_outbox, relay_events, delegations RESTART IDENTITY CASCADE"); }); afterAll(async () => pool.end());
  it("consumes a short-lived state once and registers a Slack-bound device", async () => {
    const { publicKey } = generateKeyPairSync("ed25519"); const key = publicKey.export({ type: "spki", format: "pem" }).toString(); const pending = await service.start({ deviceId: "alice-mac", publicKey: key, redirectUri: "https://relay.example/v1/enrollment/callback", teamId: "T1" });
    const device = await service.complete(pending.state, { teamId: "T1", userId: "U1" }); expect(device).toMatchObject({ id: "alice-mac", organizationId: "T1", userId: "U1" }); expect((await service.loadDevices()).get("alice-mac")?.publicKey).toBe(key);
    await expect(service.complete(pending.state, { teamId: "T1", userId: "U1" })).rejects.toThrow("invalid_enrollment_state");
  });
  it("rejects expired state and supports revocation", async () => {
    const { publicKey } = generateKeyPairSync("ed25519"); const pending = await service.start({ deviceId: "bob-mac", publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(), redirectUri: "https://relay.example/callback" }); now += 11 * 60_000;
    await expect(service.complete(pending.state, { teamId: "T1", userId: "U2" })).rejects.toThrow("expired_enrollment_state"); now = 1_000; const next = await service.start({ deviceId: "bob-mac", publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(), redirectUri: "https://relay.example/callback" }); await service.complete(next.state, { teamId: "T1", userId: "U2" }); await service.revoke("T1", "U2", "bob-mac"); expect((await service.loadDevices()).get("bob-mac")?.revokedAt).toBeTypeOf("number");
  });
});
