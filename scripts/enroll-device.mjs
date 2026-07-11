import { generateKeyPairSync, randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { RelayClient } from "../dist/relay/client.js";

const relayUrl = process.env.PIGEON_RELAY_URL ?? process.argv[2]; if (!relayUrl) throw new Error("Usage: PIGEON_RELAY_URL=https://relay.example.com pnpm enroll");
const output = resolve(process.env.PIGEON_DEVICE_FILE ?? `${homedir()}/.pigeon/device.json`); const deviceId = process.env.PIGEON_DEVICE_ID ?? `${hostname()}-${randomUUID().slice(0, 8)}`; const pair = generateKeyPairSync("ed25519"); const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(); const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString(); const callback = new URL("/v1/enrollment/callback", relayUrl).href;
const started = await fetch(new URL("/v1/enrollment/start", relayUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId, publicKey, redirectUri: callback, ...(process.env.PIGEON_SLACK_TEAM_ID ? { teamId: process.env.PIGEON_SLACK_TEAM_ID } : {}) }) }); const result = await started.json(); if (!started.ok) throw new Error(result.error?.code ?? `enrollment_http_${started.status}`);
const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open"; const args = process.platform === "win32" ? ["/c", "start", "", result.authorizeUrl] : [result.authorizeUrl]; spawn(command, args, { detached: true, stdio: "ignore" }).unref(); process.stdout.write("Complete Sign in with Slack in your browser…\n");
const client = new RelayClient({ baseUrl: relayUrl, deviceId, privateKey }); let enrolled = false;
for (let attempt = 0; attempt < 150; attempt += 1) { await new Promise(resolve => setTimeout(resolve, 2_000)); try { await client.events(0); enrolled = true; break; } catch (error) { if (!(error instanceof Error) || error.message !== "unauthorized") throw error; } }
if (!enrolled) throw new Error("enrollment_timed_out"); await mkdir(dirname(output), { recursive: true, mode: 0o700 }); await writeFile(output, JSON.stringify({ relayUrl, deviceId, privateKey }, null, 2), { mode: 0o600 }); await chmod(output, 0o600); process.stdout.write(`Device enrolled. Credentials saved to ${output}\n`);
