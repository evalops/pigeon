import type { Scope } from "../protocol.js";
export function resolveDelegationWorkspace(label: string, scope: Scope, mappings: Record<string, string>) { if (scope === "discuss_only") return process.cwd(); const workspace = mappings[label]; if (!workspace) throw new Error("workspace_not_configured"); return workspace; }
