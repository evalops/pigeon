type Options = { clientId: string; clientSecret: string; request?: typeof fetch };
export class SlackOidcClient {
  private readonly request: typeof fetch;
  constructor(private readonly options: Options) { this.request = options.request ?? fetch; }
  authorizationUrl(input: { state: string; nonce: string; redirectUri: string; teamId?: string }) { const url = new URL("https://slack.com/openid/connect/authorize"); url.search = new URLSearchParams({ response_type: "code", scope: "openid profile email", client_id: this.options.clientId, state: input.state, nonce: input.nonce, redirect_uri: input.redirectUri, ...(input.teamId ? { team: input.teamId } : {}) }).toString(); return url; }
  async exchange(input: { code: string; redirectUri: string }) {
    const tokenResponse = await this.request("https://slack.com/api/openid.connect.token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.options.clientId, client_secret: this.options.clientSecret, code: input.code, redirect_uri: input.redirectUri }) }); const token = await tokenResponse.json() as { ok: boolean; access_token?: string; error?: string }; if (!tokenResponse.ok || !token.ok || !token.access_token) throw new Error(`slack_oidc:${token.error ?? tokenResponse.status}`);
    const infoResponse = await this.request("https://slack.com/api/openid.connect.userInfo", { method: "POST", headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" } }); const info = await infoResponse.json() as Record<string, unknown>; if (!infoResponse.ok || info.ok !== true) throw new Error(`slack_oidc:${String(info.error ?? infoResponse.status)}`); const teamId = String(info["https://slack.com/team_id"] ?? ""); const userId = String(info["https://slack.com/user_id"] ?? info.sub ?? ""); if (!teamId || !userId) throw new Error("invalid_slack_identity"); return { teamId, userId };
  }
}
