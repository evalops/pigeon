# Company relay operations

## Security boundary

The relay stores delegation metadata and an append-only event stream. It never needs OpenAI credentials or local workspace contents. Slack can reject any request and approve only `discuss_only`; `read_only` and `workspace_write` approval must occur through native confirmation in the recipient's Codex.

## Local deployment

1. Start Docker Desktop.
2. Copy `.env.example` to `.env` and keep it untracked.
3. Encode each device's public `DeviceIdentity` JSON as base64url and join the values with commas in `PIGEON_DEVICES`. Private keys stay on their corresponding Codex machines.
4. Run `docker compose up --build`.
5. Confirm `curl http://127.0.0.1:8787/healthz` returns `{ "ok": true }`.

Run the production-component smoke test against the Compose database:

```bash
pnpm build
PIGEON_SMOKE_DATABASE_URL=postgres://pigeon:pigeon-local@127.0.0.1:55432/pigeon pnpm smoke:relay
```

## Slack app

Create an internal Slack app with bot scope `chat:write`. Enable interactivity and point the request URL to `https://YOUR_RELAY/v1/slack/actions`. Store the bot token and signing secret in the deployment secret manager. Pigeon verifies Slack's timestamped HMAC signature over the raw form body before accepting an interaction.

Action messages use DMs. Elevated requests show Reject and Open in Codex; discussion-only requests also show Approve. Channel posting and parsing thread replies as commands are intentionally unsupported.

## Gateway configuration

Configure the plugin MCP process with `PIGEON_RELAY_URL`, `PIGEON_DEVICE_ID`, `PIGEON_DEVICE_PRIVATE_KEY`, `PIGEON_USER`, and a comma-separated `PIGEON_TEAMMATES`. Restart Codex after changing plugin environment. Without relay variables, Pigeon uses its deterministic in-process evaluation mode.

## Production prerequisites

- Put the relay behind managed TLS and company ingress authentication controls.
- Store Postgres credentials, Slack tokens, and device registration data in the company secret manager.
- Replace static `PIGEON_DEVICES` bootstrap with the company's SSO-backed device enrollment process.
- Back up Postgres, monitor `/healthz`, outbox lag, signature failures, state conflicts, and capability replay attempts.
- Export append-only security events to the company logging system and apply the retention policy in the design spec.
- Exercise device revocation and the organization-wide kill switch before enabling `workspace_write`.

The shipped adapter completes an approved relay lifecycle but does not yet launch a recipient Codex app-server task. Keep `workspace_write` disabled until that adapter and company policy enforcement are integrated and security-reviewed.
