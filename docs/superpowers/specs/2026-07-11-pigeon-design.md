# Pigeon Design

## Purpose

Pigeon is an approval-gated, agent-to-agent delegation plugin for Codex teams. A sender asks a named teammate's Codex to perform a bounded task. The recipient reviews the request locally, may narrow its permissions, and explicitly approves or rejects it. Approved work runs as a real Codex task and returns attributed progress and results to the sender.

## MVP scope

The repository is a TypeScript monorepo containing:

- a Codex plugin with an MCP connection and a delegation workflow skill;
- a relay service that routes durable delegation events without receiving Codex credentials;
- a local gateway that authenticates a teammate, serves the embedded approval app, launches Codex through the app-server protocol, and streams sanitized events;
- an embedded plugin app containing the delegation inbox, request detail, scope editor, progress, and result views;
- a CLI for pairing, serving the gateway, delegating, inspecting status, messaging, and cancelling;
- unit and integration tests, including an in-process two-teammate scenario;
- Docker-based local evaluation and concise operational documentation.

Hosted production deployment, organization administration, billing, and repository synchronization are deferred. Terminal approval exists only as test and recovery tooling; it is not the primary user experience.

## Architecture

Each teammate runs a local gateway. Gateways connect outbound to a shared relay using authenticated WebSockets or HTTP streaming. Codex sees Pigeon's MCP tools and embedded app through the plugin and sends delegation requests to its local gateway. The relay stores and forwards a minimal event log. It never starts Codex or receives a user's OpenAI credentials.

The recipient gateway is the sole authority for approval. The embedded app lets the recipient inspect and narrow a request, but pressing Approve does not grant authority immediately. It invokes a native confirmation request that restates sender, objective, workspace, and effective scope. Only the confirmed native response creates the signed approval. The gateway then adapts the request into Codex app-server calls: create a thread, start a turn, subscribe to progress, and relay a bounded result. The app-server adapter is isolated behind an interface so protocol changes do not affect the relay or MCP contract. Tests use a deterministic fake adapter; an executable adapter targets a locally configured Codex app-server command.

## Delegation lifecycle

A delegation moves through `pending`, `approved`, `running`, and one terminal state: `completed`, `rejected`, `cancelled`, or `failed`. State changes are append-only and validated by a transition table.

1. The sender selects a teammate, objective, workspace hint, and requested scope.
2. The relay delivers the signed request to the recipient gateway.
3. The request appears in the recipient's embedded Pigeon inbox with sender identity, objective, workspace, scope, and expiry.
4. The recipient inspects the request and may narrow its scope. Scope can never be widened during approval.
5. Approve triggers a native confirmation containing the final authority grant. Reject records rejection without confirmation.
6. A confirmed approval starts a fresh Codex thread and forwards attributed progress into the embedded app and sender stream.
7. Either party may cancel. Completion returns a structured summary and evidence references.

## Permission model

The default scope is `discuss_only`. MVP scopes are ordered:

1. `discuss_only`: no workspace operations.
2. `read_only`: workspace reads and safe diagnostics.
3. `workspace_write`: edits limited to one approved workspace root.

Command execution and external side effects are not implicitly granted by `workspace_write`. The gateway maps scope to Codex sandbox settings and rejects workspace paths outside its local allowlist. Approval records requested and effective scopes. Requests expire and cannot be replayed.

## Identity and transport

The MVP uses per-user Ed25519 keypairs generated locally. Pairing exchanges public identity and a relay-issued team token. Delegation envelopes are signed end-to-end; the relay verifies membership and signatures but holds no private keys. Local development supports an in-memory relay and explicit insecure loopback mode. Secrets and private keys are excluded from logs and version control.

## Public interfaces

The MCP server exposes `list_teammates`, `delegate_to_teammate`, `get_delegation`, `send_delegation_message`, `cancel_delegation`, and app-facing inbox/detail resources. Approval is a two-step app action: `prepare_approval` validates and narrows scope, then requests native confirmation; `confirm_approval` accepts only the short-lived confirmation capability produced by that interaction.

The gateway CLI exposes `init`, `pair`, `serve`, `delegate`, `status`, and `cancel`. Hidden test/recovery commands can approve or reject only in explicit loopback development mode. Production approval is unavailable outside the embedded app plus native confirmation flow.

Protocol messages use versioned JSON schemas. Errors use stable codes for authentication, authorization, invalid transitions, expiry, unavailable peers, and adapter failures.

## Reliability and safety

Events carry monotonic sequence numbers and idempotency keys. Reconnection resumes after the last acknowledged event. Duplicate delivery must not start duplicate Codex tasks. Cancellation is best-effort at the transport boundary and mandatory at the local adapter boundary. Audit entries record identities, timestamps, state changes, requested/effective scope, and result metadata without prompts, secrets, or model reasoning.

## Testing and acceptance

Implementation follows test-driven development. Unit tests cover schemas, signatures, scope narrowing, transitions, expiry, path allowlists, confirmation capabilities, idempotency, and redaction. Component tests cover inbox states, request detail, scope editing, rejection, approval preparation, native-confirmation cancellation, progress, and results. Integration tests run two gateways against an in-process relay and fake Codex adapters.

The MVP is accepted when:

- two locally paired teammates can discover each other;
- one delegates a task and it appears in the other's embedded inbox;
- rejection prevents execution;
- approval can narrow but not widen scope;
- clicking Approve requires a separate native confirmation showing the effective authority;
- cancelling native confirmation prevents execution;
- approval starts exactly one Codex adapter task;
- progress, completion, cancellation, expiry, and reconnect work end-to-end;
- plugin validation, type checking, tests, linting, and a local smoke test pass;
- the public `evalops/pigeon` repository contains no credentials or private environment data.

## Distribution

The plugin manifest is generated with `$plugin-creator`, includes `skills/`, `.mcp.json`, and `.app.json`, and is validated with the skill's validator. A repo-local marketplace entry makes the plugin installable by teammates. The repository is published publicly as `evalops/pigeon` after a final availability check.
