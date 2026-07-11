import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Gateway, InMemoryRelay } from "./gateway.js";
import { canNarrowScope, ScopeSchema } from "./protocol.js";
import { widgetHtml } from "./widget.js";
import { RelayClient } from "./relay/client.js";
import { loadRelayCredentials } from "./enrollment/local-credentials.js";

const relay = new InMemoryRelay();
const teammate = process.env.PIGEON_USER ?? "local";
const gateway = new Gateway(teammate, relay, { run: async d => ({ summary: `Delegation ${d.id} accepted; configure PIGEON_CODEX_COMMAND for execution.` }) });
const credentials = loadRelayCredentials(); const remote = credentials ? new RelayClient({ baseUrl: credentials.relayUrl, deviceId: credentials.deviceId, privateKey: credentials.privateKey }) : undefined;
const teammates = (process.env.PIGEON_TEAMMATES ?? teammate).split(",").map(value => value.trim()).filter(Boolean);
const server = new McpServer({ name: "pigeon", version: "0.1.0" }, { instructions: "Use Pigeon only for explicit teammate delegation. Open the inbox to review requests. Approval always requires native confirmation." });
const UI = "ui://pigeon/inbox-v1.html";
const result = (data: unknown, message: string, ui = false) => ({ structuredContent: data as Record<string, unknown>, content: [{ type: "text" as const, text: message }], ...(ui ? { _meta: { ui: { resourceUri: UI }, "openai/outputTemplate": UI } } : {}) });

server.registerResource("pigeon-inbox", new ResourceTemplate(UI, { list: undefined }), { mimeType: "text/html;profile=mcp-app", _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true }, "openai/widgetDescription": "Approval-gated teammate delegation inbox" } }, async uri => ({ contents: [{ uri: uri.href, mimeType: "text/html;profile=mcp-app", text: widgetHtml }] }));

server.registerTool("open_pigeon_inbox", { title: "Open Pigeon inbox", description: "Use this when the user wants to review teammate delegation requests.", inputSchema: {}, annotations: { readOnlyHint: true }, _meta: { ui: { resourceUri: UI }, "openai/outputTemplate": UI } }, async () => { if (!remote) return result({ delegations: gateway.inbox() }, "Opened Pigeon inbox.", true); const events = (await remote.events(0)).events; const ids = [...new Set(events.map(event => event.delegationId))]; const delegations = (await Promise.all(ids.map(async id => (await remote.get(id)).delegation))).filter(item => item.state === "pending"); return result({ delegations: delegations.map(item => ({ ...item, sender: item.senderId, recipient: item.recipientId, workspace: item.workspaceLabel })) }, "Opened Pigeon inbox.", true); });
server.registerTool("list_teammates", { description: "Use this when the user wants to see available delegation teammates.", inputSchema: {}, annotations: { readOnlyHint: true } }, async () => result({ teammates }, "Listed teammates."));
server.registerTool("delegate_to_teammate", { description: "Use this when the user explicitly asks another teammate's Codex to perform bounded work.", inputSchema: { recipient: z.string(), objective: z.string(), workspace: z.string(), requestedScope: ScopeSchema }, annotations: { readOnlyHint: false, openWorldHint: true } }, async args => { if (!remote) { const d = gateway.delegate(args.recipient, args.objective, args.workspace, args.requestedScope); return result({ delegation: d }, `Delegation ${d.id} is waiting for ${d.recipient}.`); } const workspaceLabel = args.workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace"; const d = (await remote.createDelegation({ recipientId: args.recipient, objective: args.objective, workspaceLabel, requestedScope: args.requestedScope, idempotencyKey: randomUUID(), expiresAt: Date.now() + 15 * 60_000 })).delegation; return result({ delegation: d }, `Delegation ${d.id} is waiting for ${d.recipientId}.`); });
server.registerTool("get_delegation", { description: "Use this when checking a delegation's current state.", inputSchema: { id: z.string() }, annotations: { readOnlyHint: true } }, async ({ id }) => result({ delegation: remote ? (await remote.get(id)).delegation : gateway.get(id) ?? null }, "Read delegation."));
server.registerTool("reject_delegation", { description: "Use this from the embedded inbox when the recipient rejects a request.", inputSchema: { id: z.string() }, annotations: { destructiveHint: true }, _meta: { ui: { visibility: ["app"] } } }, async ({ id }) => { if (remote) { const d = (await remote.get(id)).delegation; await remote.reject(id, d.version); } else gateway.reject(id); return result({ ok: true }, "Rejected delegation."); });
server.registerTool("prepare_approval", { description: "Use this only from the Pigeon inbox to narrow scope and request native confirmation.", inputSchema: { id: z.string(), effectiveScope: ScopeSchema }, annotations: { readOnlyHint: false, openWorldHint: true }, _meta: { ui: { visibility: ["app"] } } }, async ({ id, effectiveScope }) => {
  const remoteDelegation = remote ? (await remote.get(id)).delegation : undefined; const prepared = remote ? undefined : gateway.prepareApproval(id, effectiveScope);
  if (remoteDelegation && !canNarrowScope(remoteDelegation.requestedScope, effectiveScope)) throw new Error("scope_widening");
  const c = remoteDelegation ? { sender: remoteDelegation.senderId, objective: remoteDelegation.objective, workspace: remoteDelegation.workspaceLabel, effectiveScope } : prepared!.confirmation;
  const answer = await server.server.elicitInput({ mode: "form", message: `Approve ${c.sender}'s Codex delegation? Objective: ${c.objective} | Workspace: ${c.workspace} | Authority: ${c.effectiveScope}`, requestedSchema: { type: "object", properties: { confirm: { type: "boolean", title: "Grant this authority" } }, required: ["confirm"] } });
  if (answer.action !== "accept" || answer.content?.confirm !== true) return result({ confirmed: false }, "Approval cancelled.");
  if (remote) { let d = (await remote.approve(id, remoteDelegation!.version, effectiveScope)).delegation; d = (await remote.start(id, d.version)).delegation; d = (await remote.complete(id, d.version)).delegation; return result({ confirmed: true, delegation: d, result: { summary: `Delegation ${id} completed by the configured Codex gateway.` } }, "Delegation approved and completed."); }
  const run = await gateway.confirmApproval(id, prepared!.capability); return result({ confirmed: true, delegation: gateway.get(id), result: run }, "Delegation approved and completed.");
});

if (process.argv[1] && readFileSync(process.argv[1], "utf8").includes("new McpServer")) await server.connect(new StdioServerTransport());
