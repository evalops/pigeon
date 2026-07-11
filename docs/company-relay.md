# Company relay operations

## Security boundary

The relay stores delegation metadata and an append-only event stream. It never needs OpenAI credentials or local workspace contents. Slack can reject any request and approve only `discuss_only`; `read_only` and `workspace_write` approval must occur through native confirmation in the recipient's Codex.

## Local deployment

1. Start Docker Desktop.
2. Copy `.env.example` to `.env` and keep it untracked.
3. Configure `PIGEON_SLACK_CLIENT_ID` and `PIGEON_SLACK_CLIENT_SECRET` for Sign in with Slack. Static `PIGEON_DEVICES` remains available only for recovery and local fixtures.
4. Run `docker compose up --build`.
5. Confirm `curl http://127.0.0.1:8787/healthz` returns `{ "ok": true }`.

Run the production-component smoke test against the Compose database:

```bash
pnpm build
PIGEON_SMOKE_DATABASE_URL=postgres://pigeon:pigeon-local@127.0.0.1:55432/pigeon pnpm smoke:relay
```

## Slack app

Create an internal Slack app with bot scope `chat:write` and Sign in with Slack scopes `openid profile email`. Enable interactivity and point the request URL to `https://YOUR_RELAY/v1/slack/actions`. Add `https://YOUR_RELAY/v1/enrollment/callback` as an OAuth redirect URL. Store the bot token, signing secret, client ID, and client secret in the deployment secret manager. Pigeon verifies Slack's timestamped HMAC signature over the raw form body before accepting an interaction.

Action messages use DMs. Elevated requests show Reject and Open in Codex; discussion-only requests also show Approve. Channel posting and parsing thread replies as commands are intentionally unsupported.

## Gateway configuration

After building Pigeon, enroll the machine:

```bash
PIGEON_RELAY_URL=https://YOUR_RELAY pnpm enroll
```

The enrollment command generates an Ed25519 key locally, opens Sign in with Slack, waits for the relay to recognize the device, and writes an owner-only credential file to `~/.pigeon/device.json`. The private key never leaves the machine. The plugin reads this file automatically; restart Codex after enrollment.

Set `PIGEON_WORKSPACES` to a JSON object mapping safe relay labels to absolute local roots, for example `{"pigeon":"/Users/me/src/pigeon"}`. `read_only` and `workspace_write` requests fail closed when their label is not mapped. `discuss_only` always runs in a new empty temporary directory. Set `PIGEON_CODEX_MODEL` to override the compatibility default `gpt-5.4`, and use a comma-separated `PIGEON_TEAMMATES` list for recipient discovery. Without relay credentials, Pigeon uses deterministic in-process evaluation mode.

## Production prerequisites

- Put the relay behind managed TLS and company ingress authentication controls.
- Store Postgres credentials, Slack tokens, and device registration data in the company secret manager.
- Back up Postgres, monitor `/healthz`, outbox lag, signature failures, state conflicts, and capability replay attempts.
- Export append-only security events to the company logging system and apply the retention policy in the design spec.
- Exercise device revocation and the organization-wide kill switch before enabling `workspace_write`.

Approved work launches an ephemeral local Codex app-server thread. Pigeon binds it to the approved workspace root, maps `read_only` to the read-only sandbox and `workspace_write` to the workspace-write sandbox, disables further sandbox escalation, and returns the final summary and Codex thread ID through the relay. Keep `workspace_write` limited to allowlisted teams and repositories until company policy enforcement is security-reviewed.
