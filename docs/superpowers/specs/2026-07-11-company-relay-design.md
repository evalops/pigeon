# Pigeon Company Relay Design

## Purpose

Replace Pigeon's process-local evaluation relay with a durable company service that connects employees' Codex installations. Slack is the human notification and low-risk approval surface; Codex remains the only surface that can authorize workspace reads or writes and execute delegated work.

The first production deployment targets one company Slack workspace, one Pigeon organization, and employee-managed Codex desktop installations. Multi-tenant hosting, billing, cross-company delegation, and unattended execution are outside this design.

## Authorization boundary

Pigeon supports three ordered scopes:

1. `discuss_only`: no workspace access. The recipient may approve or reject in Slack or Codex.
2. `read_only`: workspace inspection and safe diagnostics. Slack can display and deep-link the request, but approval requires native confirmation in the recipient's Codex.
3. `workspace_write`: edits within one approved workspace root. Approval requires native confirmation in the recipient's Codex.

A recipient may narrow a request but never widen it. Company policy may force Codex confirmation for any scope, repository, team, or data classification. Slack never receives a capability that can authorize filesystem access. A Slack approval for `discuss_only` creates only a discussion capability.

## Architecture

The system has four bounded components:

- **Relay API:** authenticates clients, validates commands, stores durable state, issues short-lived capabilities, and exposes HTTPS plus WebSocket or server-sent event streams.
- **Postgres:** stores organizations, identities, linked Slack accounts, device registrations, delegations, append-only events, approvals, capabilities, and delivery cursors.
- **Slack app:** posts App Home and DM notifications, handles interactive low-risk decisions, and creates links that open the corresponding request in Codex.
- **Pigeon Codex gateway:** runs on the employee's machine as the plugin MCP server, maintains an outbound authenticated relay connection, renders the inbox, performs native confirmation, maps effective scope to local Codex permissions, and executes through the Codex app-server adapter.

The relay coordinates work but never receives OpenAI credentials, local file contents, chain-of-thought, or unrestricted command output. Execution remains local to the recipient's Codex environment.

## Identity and device trust

Company identity is anchored in Slack for the first release. Installation begins with a relay-generated device-link URL. The employee completes Slack OAuth, and the relay binds the Slack workspace ID and Slack user ID to a Pigeon user. Email addresses are display metadata and are not identity keys.

Each Codex installation creates a non-exportable device key when platform facilities permit, otherwise an encrypted local Ed25519 key. The relay registers the public key and returns a revocable device credential. All delegation commands are signed by the device and authenticated over TLS. An organization administrator can revoke a user or individual device.

The relay accepts events only when organization, user, device, and Slack linkage are active. Slack request signatures are verified independently. OAuth tokens and device credentials are encrypted at rest with a managed KMS key.

## Delegation and approval flow

1. The sender's gateway submits a signed delegation containing recipient, objective, workspace hint, requested scope, expiry, and idempotency key.
2. The relay validates policy, stores the request and first event transactionally, and enqueues notification delivery.
3. The Slack app sends the recipient a DM and updates Pigeon App Home. The recipient's connected gateways receive the same event.
4. For `discuss_only`, Slack presents Approve, Reject, and Open in Codex. Approval records the Slack actor and issues a single-use discussion capability.
5. For `read_only` or `workspace_write`, Slack presents Reject and Open in Codex. The Codex inbox permits scope narrowing and requests native confirmation showing sender, objective, local workspace resolution, and effective authority.
6. The gateway exchanges the accepted native confirmation for a single-use execution lease. The lease is bound to delegation, recipient, device, resolved workspace root, effective scope, expiry, and repository revision when available.
7. The local adapter starts one Codex task. Progress is reduced to explicit status events and user-safe summaries before transmission.
8. The gateway records completion, failure, or cancellation. The relay updates Slack and the sender's Codex.

The authoritative lifecycle is `pending -> approved -> running -> completed`, with `rejected`, `expired`, `cancelled`, and `failed` terminal alternatives. Every transition uses optimistic concurrency and an idempotency key.

## Slack experience

Pigeon uses DMs for actionable notifications and App Home for the durable inbox. Channel posting is optional and off by default to avoid leaking objectives or repository names.

A request message shows sender, objective, requested scope, expiry, and a minimal workspace label. It does not show absolute local paths. Slack actions are handled asynchronously: the app acknowledges immediately, then the worker validates current state and updates the message. Stale or duplicate interactions return the current authoritative state.

For elevated scopes, **Open in Codex** uses a signed, short-lived deep link containing only an opaque request ID. If deep linking is unavailable, the message instructs the recipient to open the Pigeon inbox in Codex. Slack rejection is allowed for every scope because it grants no authority.

Thread replies are not treated as protocol commands. Discussion may occur in Slack, but decisions enter the system only through verified interactive actions or Codex tools.

## Data model and retention

Core records are `organizations`, `users`, `slack_links`, `devices`, `delegations`, `delegation_events`, `approvals`, `capabilities`, `delivery_attempts`, and `policy_rules`.

`delegations` contains the current materialized state for efficient reads. `delegation_events` is append-only and contains actor, source surface, transition, timestamp, request correlation ID, and redacted metadata. Capabilities are stored as hashes, expire within minutes, and are marked consumed in the same transaction that advances state.

Objectives and result summaries are retained for 30 days by default; audit metadata is retained for one year. Organizations can shorten both periods. Absolute workspace paths, file contents, prompts, tool transcripts, secrets, and model reasoning are never stored by the relay. Deletion removes message content while retaining minimal security audit facts where company policy requires them.

## Reliability and operations

The relay runs as at least two stateless application instances behind a load balancer. Postgres is the source of truth. A transactional outbox drives Slack and gateway delivery, avoiding a separate message broker initially. Workers retry transient failures with bounded exponential backoff and dead-letter persistent failures for operator review.

Gateways reconnect using a persisted cursor and receive all events after their last acknowledged sequence. Event delivery is at least once; command effects are exactly once through idempotency and state-transition constraints. Only one active execution lease may exist per delegation.

Operational signals include request latency, notification latency, connected devices, approval latency, execution starts, terminal outcomes, retry counts, Slack API errors, invalid signatures, rejected transitions, and capability replay attempts. Alerts cover sustained delivery failure, database saturation, signature anomalies, and growing outbox lag.

## Security controls

- TLS for every network connection and managed encryption at rest.
- Slack request verification, minimal OAuth scopes, token rotation, and immediate revocation handling.
- Signed device commands with timestamp and nonce replay protection.
- Short-lived, audience-bound, single-use capabilities stored only as hashes.
- Organization and recipient checks on every read and transition.
- Local workspace allowlists and canonical-path checks in the gateway.
- Policy enforcement both when a request is created and immediately before execution.
- Structured redaction at the gateway and relay; no raw model transcript ingestion.
- Rate limits per organization, sender, recipient, device, and Slack action.
- Append-only audit events exported to the company's security logging system.
- Administrative device revocation and an organization-wide execution kill switch.

Compromise of Slack alone can approve only `discuss_only` requests. Compromise of the relay cannot access local workspaces without a recipient device, native confirmation for elevated scopes, and a valid execution lease.

## Failure behavior

If Slack is unavailable, requests remain visible and actionable in Codex. If a recipient is offline, the relay retains the request until expiry. If the relay connection drops during execution, the gateway continues only under its already-issued lease, buffers bounded status events, and reconciles when connectivity returns.

Policy changes or device revocation invalidate unconsumed capabilities and prevent new execution leases. Cancellation interrupts the local Codex task when possible; late completion events are recorded for diagnosis but cannot move a cancelled delegation back to completed. Slack message update failures do not change authoritative state.

## Deployment sequence

1. Deploy a single-company staging relay, Postgres, Slack app, and transactional outbox worker.
2. Add device linking, identity mapping, durable event streaming, and App Home/DM notifications.
3. Enable Slack approval for `discuss_only` and Codex deep links for elevated requests.
4. Replace the fake adapter with the local Codex app-server adapter and enforce execution leases.
5. Pilot with one engineering team using `discuss_only` and `read_only` only.
6. Complete security review, audit export, revocation exercises, and recovery testing.
7. Enable `workspace_write` for explicitly allowed repositories and teams.

## Testing and acceptance

Unit tests cover policy evaluation, Slack signature verification, device signatures, scope narrowing, capability binding and consumption, state transitions, idempotency, expiry, redaction, and canonical workspace resolution.

Integration tests run two isolated gateways against Postgres and the relay, with fake Slack and Codex adapters. They verify reconnect, duplicate delivery, concurrent approval, revocation, cancellation races, outbox retry, Slack-only discussion approval, and mandatory Codex confirmation for elevated scopes.

End-to-end staging tests use two real Slack users and two Codex installations. The release is accepted when:

- a sender can delegate to a linked teammate and both Slack and Codex receive the request;
- Slack can approve only `discuss_only` authority;
- elevated scopes require native Codex confirmation and can be narrowed;
- one approval starts at most one local task;
- offline recipients, reconnects, retries, expiry, cancellation, and revocation behave deterministically;
- no relay record or log contains local file contents, absolute workspace paths, secrets, prompts, or model reasoning;
- audit exports reconstruct every security-relevant transition;
- a Slack or relay compromise alone cannot authorize workspace access.

## Initial technology choices

Keep the current TypeScript codebase. Implement the relay as a small Node service with Postgres, HTTPS, and WebSocket or server-sent event endpoints. Use Slack's official SDK for OAuth, App Home, DMs, and interactive actions. Use a migration tool compatible with Postgres, a managed KMS for secrets, and the company's existing container platform and observability stack.

Do not introduce Kafka, Redis, Kubernetes-specific operators, or a policy language in the first release. The Postgres outbox, explicit TypeScript policy functions, and existing deployment platform are sufficient until measured load or organizational complexity proves otherwise.
