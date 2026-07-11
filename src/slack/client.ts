type DelegationNotice = { id: string; recipientSlackId: string; senderLabel: string; objective: string; workspaceLabel: string; requestedScope: "discuss_only" | "read_only" | "workspace_write"; expiresAt: number };
type Fetch = typeof fetch;

export class SlackClient {
  constructor(private readonly token: string, private readonly request: Fetch = fetch) {}
  async postDelegation(notice: DelegationNotice) {
    const actions: Array<Record<string, unknown>> = [
      { type: "button", text: { type: "plain_text", text: "Reject" }, style: "danger", action_id: "reject", value: notice.id },
      { type: "button", text: { type: "plain_text", text: "Open in Codex" }, action_id: "open_codex", value: notice.id }
    ];
    if (notice.requestedScope === "discuss_only") actions.unshift({ type: "button", text: { type: "plain_text", text: "Approve" }, style: "primary", action_id: "approve_discuss", value: notice.id });
    const body = { channel: notice.recipientSlackId, text: `Pigeon request from ${notice.senderLabel}: ${notice.objective}`, blocks: [
      { type: "header", text: { type: "plain_text", text: "New Pigeon request" } },
      { type: "section", fields: [{ type: "mrkdwn", text: `*From*\n${notice.senderLabel}` }, { type: "mrkdwn", text: `*Scope*\n${notice.requestedScope}` }, { type: "mrkdwn", text: `*Workspace*\n${notice.workspaceLabel}` }, { type: "mrkdwn", text: `*Expires*\n${new Date(notice.expiresAt).toISOString()}` }] },
      { type: "section", text: { type: "mrkdwn", text: notice.objective } }, { type: "actions", elements: actions }
    ] };
    const response = await this.request("https://slack.com/api/chat.postMessage", { method: "POST", headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
    const result = await response.json() as { ok: boolean; error?: string; channel?: string; ts?: string }; if (!response.ok || !result.ok) throw new Error(`slack:${result.error ?? response.status}`); return result;
  }
}
