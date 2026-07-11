# pigeon

Tiny, approval-gated delegation between teammates' Codex agents.

Pigeon packages an MCP server, an embedded delegation inbox, scope narrowing, and native MCP confirmation. EvalOps Agent Kit owns authentication, durable Agent Runtime state, local authority, and Codex app-server execution; Pigeon never receives Platform refresh credentials or OpenAI credentials.

## What works

- `delegate_to_teammate` creates a bounded request.
- `open_pigeon_inbox` renders the embedded inbox.
- The recipient can reject or narrow `workspace_write` → `read_only` → `discuss_only`.
- Approve triggers MCP `elicitation/create`; cancelling it starts nothing.
- Agent Kit records the confirmed scope and performs execution under a fenced Platform lease.
- Pigeon production mode never falls back to process-local state.

Pigeon connects only to the owner-only Agent Kit Unix socket. Platform Agent Runtime is the durable ledger, and the Agent Kit daemon connects outbound to Platform and Codex app-server.

## Run

```bash
corepack pnpm install
pnpm test
pnpm build
pnpm validate:plugin
node dist/server.js
```

The MCP process requires stable coordinates from Agent Kit enrollment:

```bash
export EVALOPS_AGENT_SOCKET=/tmp/evalops-agent-kit.sock
export PIGEON_ORGANIZATION_ID=org_...
export PIGEON_WORKSPACE_ID=workspace_...
export PIGEON_USER_PRINCIPAL_ID=user_...
export PIGEON_DEVICE_PRINCIPAL_ID=device_...
```

The MCP process uses stdio. Install the repo-local marketplace, then install `pigeon` and start a new Codex task so tools and skills reload.

## Approval contract

1. Sender requests the smallest useful scope.
2. Recipient reviews the request in the embedded inbox.
3. Recipient may narrow, never widen, authority.
4. The host displays a native confirmation containing sender, objective, workspace, and final scope.
5. Pigeon sends the narrowed decision to Agent Kit; the daemon records evidence and executes only after all Platform and local gates pass.

## Development

Node 22+ is supported. Tests are deterministic and require no API keys.

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc -p tsconfig.json --noEmit
```

See [SECURITY.md](SECURITY.md) for the daemon and Platform authority boundaries.
