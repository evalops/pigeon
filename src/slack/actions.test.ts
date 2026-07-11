import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSlackAction, verifySlackRequest } from "./actions.js";

describe("Slack actions", () => {
  it("verifies the raw request and parses a discussion approval", () => {
    const payload = { team: { id: "T1" }, user: { id: "U2" }, actions: [{ action_id: "approve_discuss", value: "delegation-id" }] }; const raw = `payload=${encodeURIComponent(JSON.stringify(payload))}`; const timestamp = 1_000;
    const signature = `v0=${createHmac("sha256", "secret").update(`v0:${timestamp}:${raw}`).digest("hex")}`;
    expect(verifySlackRequest(raw, timestamp, signature, "secret", timestamp)).toBe(true); expect(parseSlackAction(raw)).toMatchObject({ action: "approve", delegationId: "delegation-id", organizationId: "T1", userId: "U2" });
  });

  it("rejects stale and forged requests", () => {
    expect(() => verifySlackRequest("payload=x", 1_000, "v0=bad", "secret", 1_000_000)).toThrow("stale_slack_request");
    expect(() => verifySlackRequest("payload=x", 1_000, "v0=bad", "secret", 1_000)).toThrow("invalid_slack_signature");
  });
});
