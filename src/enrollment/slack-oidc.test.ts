import { describe, expect, it } from "vitest";
import { SlackOidcClient } from "./slack-oidc.js";

describe("Slack OIDC client", () => {
  it("builds a workspace-bound authorization URL and resolves verified user info", async () => {
    const calls: string[] = []; const client = new SlackOidcClient({ clientId: "client", clientSecret: "secret", request: async (url, init) => { calls.push(String(url)); if (String(url).endsWith("openid.connect.token")) return new Response(JSON.stringify({ ok: true, access_token: "access" }), { headers: { "content-type": "application/json" } }); return new Response(JSON.stringify({ ok: true, sub: "U1", "https://slack.com/user_id": "U1", "https://slack.com/team_id": "T1" }), { headers: { "content-type": "application/json" } }); } });
    const url = client.authorizationUrl({ state: "state", nonce: "nonce", redirectUri: "https://relay.example/callback", teamId: "T1" });
    expect(url.searchParams.get("scope")).toBe("openid profile email"); expect(url.searchParams.get("team")).toBe("T1");
    const identity = await client.exchange({ code: "code", redirectUri: "https://relay.example/callback" }); expect(identity).toEqual({ teamId: "T1", userId: "U1" }); expect(calls).toHaveLength(2);
  });
});
