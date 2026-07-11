import { describe, expect, it } from "vitest";
import { SlackClient } from "./client.js";

describe("Slack client", () => {
  it("posts a redacted delegation DM with safe actions", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const client = new SlackClient("test-token", async (url, init) => { request = { url: String(url), init }; return new Response(JSON.stringify({ ok: true, channel: "D1", ts: "1.2" }), { headers: { "content-type": "application/json" } }); });
    await client.postDelegation({ id: "opaque-id", recipientSlackId: "U2", senderLabel: "Alice", objective: "Review rollout", workspaceLabel: "pigeon", requestedScope: "read_only", expiresAt: 2_000 });
    expect(request?.url).toBe("https://slack.com/api/chat.postMessage"); const body = JSON.parse(String(request?.init?.body));
    expect(body.channel).toBe("U2"); expect(JSON.stringify(body)).not.toContain("/Users/"); expect(JSON.stringify(body)).toContain("open_codex"); expect(JSON.stringify(body)).not.toContain("approve_discuss");
  });
});
