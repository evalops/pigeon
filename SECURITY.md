# Security

Please report vulnerabilities privately through GitHub's security-advisory flow.

Pigeon treats the Agent Kit daemon as the machine authority boundary. Effective scope cannot exceed requested scope, and native confirmation is required before Pigeon sends an elevated approval decision. Never expose the Agent Kit socket or Codex app-server to the network, put Platform credentials in plugin configuration, or enable non-interactive workspace writes.

Platform Agent Runtime owns authenticated membership, replay protection, leases, durable events, and audit evidence. The local socket is owner-only; integrations receive scoped capabilities from the daemon. Pigeon must not log objectives, absolute paths, credentials, model responses, or raw daemon frames.
