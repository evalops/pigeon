import { Pool } from "pg";
import { createRelayApp } from "./app.js";
import { migrate, PostgresRelayStore } from "./postgres.js";
import type { DeviceIdentity } from "./types.js";
import { SlackClient } from "../slack/client.js";
import { deliverOutboxOnce } from "../slack/worker.js";

const databaseUrl = process.env.DATABASE_URL; if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl }); await migrate(pool);
const devices = new Map<string, DeviceIdentity>();
for (const encoded of (process.env.PIGEON_DEVICES ?? "").split(",").filter(Boolean)) { const device = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as DeviceIdentity; devices.set(device.id, device); }
const store = new PostgresRelayStore(pool); const app = createRelayApp({ store, devices, slackInternalSecret: process.env.PIGEON_SLACK_INTERNAL_SECRET, slackSigningSecret: process.env.PIGEON_SLACK_SIGNING_SECRET });
if (process.env.PIGEON_SLACK_BOT_TOKEN) { const slack = new SlackClient(process.env.PIGEON_SLACK_BOT_TOKEN); const timer = setInterval(() => { void deliverOutboxOnce(store, slack); }, 1_000); timer.unref(); }
const port = Number(process.env.PORT ?? 8787); app.listen(port, () => process.stderr.write(`Pigeon relay listening on ${port}\n`));
