---
name: pigeon
description: Delegate bounded Codex work to an authenticated teammate with recipient-controlled scope and native confirmation.
---

# Pigeon

Use `list_teammates` before delegation. State the objective, workspace hint, and smallest sufficient requested scope. Default to `discuss_only`; use `read_only` for inspection and `workspace_write` only when the user explicitly requests edits.

The recipient owns approval. Never represent a pending request as accepted. Use `get_delegation` for status. Open `open_pigeon_inbox` when the local user wants to review incoming work. The embedded app may narrow scope and must complete the native confirmation before execution begins.
