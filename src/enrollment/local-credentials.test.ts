import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRelayCredentials } from "./local-credentials.js";

describe("local credentials", () => {
  it("loads an explicit owner-managed device file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "pigeon-")), "device.json"); writeFileSync(path, JSON.stringify({ relayUrl: "https://relay.example", deviceId: "device", privateKey: "key" }));
    expect(loadRelayCredentials({ PIGEON_DEVICE_FILE: path })).toEqual({ relayUrl: "https://relay.example", deviceId: "device", privateKey: "key" });
  });
});
