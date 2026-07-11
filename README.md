# pigeon

Tiny, approval-gated delegation between teammates' Codex agents.

Pigeon packages an MCP server, an embedded delegation inbox, signed authority envelopes, scope narrowing, and a native MCP confirmation before work can begin. The relay never receives Codex or OpenAI credentials.

## What works

- `delegate_to_teammate` creates a bounded request.
- `open_pigeon_inbox` renders the embedded inbox.
- The recipient can reject or narrow `workspace_write` → `read_only` → `discuss_only`.
- Approve triggers MCP `elicitation/create`; cancelling it starts nothing.
- Confirmation capabilities are short-lived and single-use.
- Delegation state transitions and Ed25519 envelopes are tested.

The default transport remains an in-process evaluation relay. A Postgres-backed, signed HTTP relay is also included for durable cross-window and cross-machine delivery. See [Company relay operations](docs/company-relay.md).

## Run

```bash
corepack pnpm install
pnpm test
pnpm build
pnpm validate:plugin
node dist/server.js
```

The MCP process uses stdio. Install the repo-local marketplace, then install `pigeon` and start a new Codex task so tools and skills reload.

For company-relay development, run `docker compose up postgres`, then use `PIGEON_TEST_DATABASE_URL=postgres://pigeon:pigeon-local@127.0.0.1:55432/pigeon pnpm test`.

## Approval contract

1. Sender requests the smallest useful scope.
2. Recipient reviews the request in the embedded inbox.
3. Recipient may narrow, never widen, authority.
4. The host displays a native confirmation containing sender, objective, workspace, and final scope.
5. Only the resulting one-use capability can start the adapter.

## Development

Node 20+ is supported. Tests are intentionally deterministic and require no API keys.

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc -p tsconfig.json --noEmit
```

See [SECURITY.md](SECURITY.md) before replacing the in-process relay.
