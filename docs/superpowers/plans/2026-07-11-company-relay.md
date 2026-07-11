# Pigeon Company Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployable, Postgres-backed Pigeon relay with signed device authentication, Slack notifications and low-risk approvals, and a Codex gateway client for durable cross-window delegation.

**Architecture:** A stateless TypeScript HTTP service owns durable delegation state in Postgres and records an append-only event stream plus transactional delivery outbox. The local MCP gateway signs relay commands, polls recipient events, performs elevated approval in Codex, and never sends workspace content to the relay. A Slack adapter posts requests and accepts only reject or `discuss_only` approval actions.

**Tech Stack:** Node.js 20+, TypeScript, Express 5, Postgres 15+, `pg`, Zod, Slack Web API over HTTPS, Vitest, Docker Compose.

## Global Constraints

- Slack may approve only `discuss_only`; `read_only` and `workspace_write` require native Codex confirmation.
- Scope may be narrowed and never widened.
- Relay records must not contain absolute workspace paths, file contents, prompts, tool transcripts, secrets, or model reasoning.
- Capabilities are audience-bound, short-lived, single-use, and stored as hashes.
- Postgres is authoritative; delivery is at least once and command effects are idempotent.
- Do not add Kafka, Redis, or a policy language.

---

### Task 1: Durable protocol and store

**Files:**
- Create: `src/relay/types.ts`
- Create: `src/relay/store.ts`
- Create: `src/relay/memory-store.ts`
- Create: `src/relay/store.test.ts`
- Modify: `src/protocol.ts`

**Interfaces:**
- Produces: `RelayStore`, `RelayCommand`, `RelayEvent`, `DeviceIdentity`, `CreateDelegationInput`, and `MemoryRelayStore`.
- `RelayStore.createDelegation(input, actor)` returns the stored delegation and event atomically.
- `RelayStore.transition(id, expectedVersion, command, actor)` enforces state and scope rules.

- [ ] Write tests for idempotent creation, recipient isolation, narrowing, invalid widening, optimistic concurrency, expiry, terminal states, and redacted workspace labels.
- [ ] Run `pnpm vitest run src/relay/store.test.ts` and verify the new module is missing.
- [ ] Add exact Zod schemas and the `RelayStore` interface; implement the deterministic memory store used by unit tests.
- [ ] Run `pnpm vitest run src/relay/store.test.ts` and verify all store tests pass.
- [ ] Commit with `git commit -m "feat: define durable relay store"`.

### Task 2: Postgres persistence and transactional outbox

**Files:**
- Create: `src/relay/postgres.ts`
- Create: `src/relay/migrations/001_relay.sql`
- Create: `src/relay/postgres.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `RelayStore` from Task 1.
- Produces: `PostgresRelayStore`, `migrate(pool)`, `claimOutbox(limit)`, `completeOutbox(id)`, and `failOutbox(id, error)`.

- [ ] Write integration tests gated by `PIGEON_TEST_DATABASE_URL` for atomic create/event/outbox writes, duplicate idempotency keys, concurrent transitions, event cursors, and retry claims.
- [ ] Run the tests without the database variable and verify they skip cleanly; run them against Docker Postgres and verify they fail before implementation.
- [ ] Add `pg`, the migration, parameterized queries, transactions, row locking, uniqueness constraints, and `FOR UPDATE SKIP LOCKED` outbox claims.
- [ ] Run Postgres integration tests and verify all cases pass.
- [ ] Commit with `git commit -m "feat: persist relay state in postgres"`.

### Task 3: Signed relay HTTP API

**Files:**
- Create: `src/relay/auth.ts`
- Create: `src/relay/auth.test.ts`
- Create: `src/relay/app.ts`
- Create: `src/relay/app.test.ts`
- Create: `src/relay/main.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `RelayStore` and device public keys.
- Produces: `createRelayApp({ store, devices, clock })`, `verifyDeviceRequest`, and HTTP endpoints `POST /v1/delegations`, `GET /v1/events`, `POST /v1/delegations/:id/approve`, `POST /v1/delegations/:id/reject`, `POST /v1/delegations/:id/start`, `POST /v1/delegations/:id/complete`, plus `GET /healthz`.

- [ ] Write tests for signatures, timestamp skew, nonce replay, tenant/recipient isolation, idempotency, Slack approval restrictions, Codex elevated approval, redacted responses, and stable error codes.
- [ ] Run the focused tests and verify failure before implementation.
- [ ] Implement canonical request signing, in-memory nonce replay protection, Zod request validation, actor/source authorization, and JSON error middleware.
- [ ] Run focused API tests and verify they pass.
- [ ] Commit with `git commit -m "feat: add signed relay api"`.

### Task 4: Slack notifications and safe interactive actions

**Files:**
- Create: `src/slack/client.ts`
- Create: `src/slack/client.test.ts`
- Create: `src/slack/actions.ts`
- Create: `src/slack/actions.test.ts`
- Modify: `src/relay/app.ts`
- Modify: `src/relay/postgres.ts`

**Interfaces:**
- Produces: `SlackClient.postDelegation`, `SlackClient.updateDelegation`, `verifySlackRequest`, `handleSlackAction`, and an outbox delivery handler.
- Slack approval calls the relay transition only when the requested and effective scopes are `discuss_only`; rejection is permitted for every scope.

- [ ] Write tests using a fake Slack HTTP server for Block Kit payload redaction, immediate action acknowledgement, request signature verification, stale actions, rejection, low-risk approval, and elevated-scope denial.
- [ ] Run focused Slack tests and verify failure before implementation.
- [ ] Implement minimal Slack Web API calls, verified interactive routes, opaque IDs, DM request blocks, and outbox retry classification.
- [ ] Run focused Slack and API tests and verify they pass.
- [ ] Commit with `git commit -m "feat: connect slack approval workflow"`.

### Task 5: Codex gateway relay client

**Files:**
- Create: `src/relay/client.ts`
- Create: `src/relay/client.test.ts`
- Modify: `src/server.ts`
- Modify: `src/gateway.ts`
- Modify: `plugins/pigeon/.mcp.json`

**Interfaces:**
- Produces: `RelayClient.createDelegation`, `RelayClient.events`, `RelayClient.approve`, `RelayClient.reject`, and `RelayClient.complete`.
- The existing MCP tools use the remote client when `PIGEON_RELAY_URL`, `PIGEON_DEVICE_ID`, and `PIGEON_DEVICE_PRIVATE_KEY` are present; otherwise they retain the evaluation-only memory relay.

- [ ] Write tests for canonical signing, event cursors, retry-safe commands, remote inbox rendering, Slack-approved discussion work, and mandatory native confirmation for elevated work.
- [ ] Run focused tests and verify failure before implementation.
- [ ] Implement the signed HTTP client and gateway adapter, keeping private keys local and sending only workspace labels.
- [ ] Run gateway, widget, client, and protocol tests and verify they pass.
- [ ] Commit with `git commit -m "feat: connect codex gateway to relay"`.

### Task 6: Deployment, operations, and release verification

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `docs/company-relay.md`
- Create: `scripts/smoke-relay.mjs`
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Produces: `pnpm relay`, `pnpm migrate`, `pnpm smoke:relay`, a health endpoint, container image, local Postgres stack, and operator setup documentation.

- [ ] Add a smoke script that registers two fixture devices, creates a delegation, reads it as the recipient, approves it through the allowed surface, and observes completion.
- [ ] Add container/deployment files with non-secret examples, health checks, migration startup, retention and revocation guidance, and Slack app configuration.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm validate:plugin`, and the Docker-backed smoke test.
- [ ] Inspect tracked files and build output for credentials, private keys, absolute personal paths, and raw workspace content.
- [ ] Commit with `git commit -m "docs: ship company relay deployment"`.
- [ ] Push the branch, open a draft pull request against `evalops/pigeon:main`, and report validation evidence and remaining production prerequisites.

### Task 7: Slack OIDC device enrollment

**Files:**
- Create: `src/enrollment/service.ts`
- Create: `src/enrollment/service.test.ts`
- Create: `src/enrollment/slack-oidc.ts`
- Create: `src/enrollment/slack-oidc.test.ts`
- Create: `scripts/enroll-device.mjs`
- Modify: `src/relay/migrations/001_relay.sql`
- Modify: `src/relay/app.ts`
- Modify: `src/relay/main.ts`

**Interfaces:**
- Produces: short-lived enrollment sessions, Slack OIDC authorization/callback endpoints, durable device registration and revocation, and a local enrollment CLI that keeps the private key on the Codex machine.

- [ ] Write failing tests for state hashing, expiry, Slack workspace/user binding, duplicate device rejection, durable lookup, and revocation.
- [ ] Implement OIDC authorization, token exchange, user-info verification, and transactional Postgres enrollment.
- [ ] Add a local CLI that generates an Ed25519 key, completes browser enrollment, and writes an owner-only device credential file.
- [ ] Run focused tests, live Postgres tests, and a two-device enrollment smoke test.
- [ ] Commit with `git commit -m "feat: enroll devices with Slack OIDC"`.

### Task 8: Real Codex app-server execution

**Files:**
- Create: `src/codex/app-server.ts`
- Create: `src/codex/app-server.test.ts`
- Modify: `src/server.ts`
- Modify: `docs/company-relay.md`

**Interfaces:**
- Produces: `CodexAppServerAdapter.run`, which starts an ephemeral Codex thread in the approved local workspace, applies the scope sandbox, starts one turn, streams until terminal completion, and returns a bounded final summary and thread ID.

- [ ] Write failing protocol tests with a deterministic JSON-RPC fixture process.
- [ ] Implement initialize, `thread/start`, `turn/start`, notification handling, timeout, cancellation, and process cleanup.
- [ ] Replace lifecycle-only remote completion with adapter execution before the final relay transition.
- [ ] Run focused tests and a real discuss-only `codex app-server` smoke task.
- [ ] Commit with `git commit -m "feat: execute delegations in codex app-server"`.
