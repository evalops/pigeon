import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

const Credentials = z.object({ relayUrl: z.string().url(), deviceId: z.string().min(1), privateKey: z.string().min(1) });
export type RelayCredentials = z.infer<typeof Credentials>;
export function loadRelayCredentials(env: NodeJS.ProcessEnv = process.env): RelayCredentials | undefined {
  if (env.PIGEON_RELAY_URL && env.PIGEON_DEVICE_ID && env.PIGEON_DEVICE_PRIVATE_KEY) return Credentials.parse({ relayUrl: env.PIGEON_RELAY_URL, deviceId: env.PIGEON_DEVICE_ID, privateKey: env.PIGEON_DEVICE_PRIVATE_KEY.replace(/\\n/g, "\n") });
  const path = resolve(env.PIGEON_DEVICE_FILE ?? `${homedir()}/.pigeon/device.json`); if (!existsSync(path)) return undefined; return Credentials.parse(JSON.parse(readFileSync(path, "utf8")));
}
