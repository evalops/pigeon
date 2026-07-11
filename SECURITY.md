# Security

Please report vulnerabilities privately through GitHub's security-advisory flow.

Pigeon treats the recipient gateway as the authority boundary. Effective scope cannot exceed requested scope; confirmation tokens are short-lived, single-use, and stored as hashes. Never expose a Codex app-server directly to the internet, forward OpenAI credentials through a relay, log private keys, or enable non-interactive production approval.

The current relay is evaluation-only and in-process. A network transport must add authenticated membership, replay protection, durable monotonic event sequences, rate limits, encryption in transit, and an append-only redacted audit log before production use.
