CREATE TABLE IF NOT EXISTS delegations (
  id uuid PRIMARY KEY, organization_id text NOT NULL, sender_id text NOT NULL, recipient_id text NOT NULL,
  objective text NOT NULL, workspace_label text NOT NULL, requested_scope text NOT NULL, effective_scope text,
  state text NOT NULL, version integer NOT NULL, idempotency_key text NOT NULL, expires_at bigint NOT NULL,
  created_at bigint NOT NULL, updated_at bigint NOT NULL,
  UNIQUE (organization_id, sender_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS relay_events (
  sequence bigserial PRIMARY KEY, delegation_id uuid NOT NULL REFERENCES delegations(id), organization_id text NOT NULL,
  recipient_id text NOT NULL, type text NOT NULL, version integer NOT NULL, actor jsonb NOT NULL, created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS relay_events_recipient_cursor ON relay_events (organization_id, recipient_id, sequence);
CREATE TABLE IF NOT EXISTS relay_outbox (
  id bigserial PRIMARY KEY, event_sequence bigint NOT NULL UNIQUE REFERENCES relay_events(sequence), payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0, available_at bigint NOT NULL, claimed_at bigint, completed_at bigint, last_error text
);
