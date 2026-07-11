import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { DeviceIdentity } from "../relay/types.js";

type StartInput = { deviceId: string; publicKey: string; redirectUri: string; teamId?: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export class EnrollmentService {
  constructor(private readonly pool: Pool, private readonly clock: () => number = Date.now) {}
  async start(input: StartInput) {
    if (!/^[A-Za-z0-9._-]{3,120}$/.test(input.deviceId)) throw new Error("invalid_device_id");
    if (!input.publicKey.includes("PUBLIC KEY")) throw new Error("invalid_public_key");
    const state = randomBytes(32).toString("base64url"); const nonce = randomBytes(24).toString("base64url"); const now = this.clock();
    await this.pool.query("INSERT INTO enrollment_sessions(state_hash,device_id,public_key,redirect_uri,team_id,nonce,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [hash(state), input.deviceId, input.publicKey, input.redirectUri, input.teamId ?? null, nonce, now + 10 * 60_000, now]);
    return { state, nonce, expiresAt: now + 10 * 60_000 };
  }
  async inspect(state: string) { const result = await this.pool.query("SELECT device_id,redirect_uri,team_id,nonce,expires_at FROM enrollment_sessions WHERE state_hash=$1", [hash(state)]); if (!result.rowCount) throw new Error("invalid_enrollment_state"); const row = result.rows[0]; if (Number(row.expires_at) < this.clock()) throw new Error("expired_enrollment_state"); return { deviceId: String(row.device_id), redirectUri: String(row.redirect_uri), teamId: row.team_id ? String(row.team_id) : undefined, nonce: String(row.nonce) }; }
  async complete(state: string, identity: { teamId: string; userId: string }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN"); const selected = await client.query("DELETE FROM enrollment_sessions WHERE state_hash=$1 RETURNING *", [hash(state)]); if (!selected.rowCount) throw new Error("invalid_enrollment_state"); const row = selected.rows[0];
      if (Number(row.expires_at) < this.clock()) throw new Error("expired_enrollment_state"); if (row.team_id && row.team_id !== identity.teamId) throw new Error("wrong_slack_workspace");
      const inserted = await client.query("INSERT INTO devices(id,organization_id,user_id,public_key,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING *", [row.device_id, identity.teamId, identity.userId, row.public_key, this.clock()]); if (!inserted.rowCount) throw new Error("device_exists"); await client.query("COMMIT"); return this.fromRow(inserted.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async loadDevices() { const result = await this.pool.query("SELECT * FROM devices"); return new Map<string, DeviceIdentity>(result.rows.map(row => { const device = this.fromRow(row); return [device.id, device]; })); }
  async revoke(organizationId: string, userId: string, deviceId: string) { const result = await this.pool.query("UPDATE devices SET revoked_at=$4 WHERE id=$1 AND organization_id=$2 AND user_id=$3 RETURNING id", [deviceId, organizationId, userId, this.clock()]); if (!result.rowCount) throw new Error("not_found"); }
  private fromRow(row: Record<string, unknown>): DeviceIdentity { return { id: String(row.id), organizationId: String(row.organization_id), userId: String(row.user_id), publicKey: String(row.public_key), ...(row.revoked_at ? { revokedAt: Number(row.revoked_at) } : {}) }; }
}
