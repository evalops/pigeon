import { readFileSync } from "node:fs";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Gateway, InMemoryRelay } from "./gateway.js";
import { ScopeSchema } from "./protocol.js";
import { widgetHtml } from "./widget.js";

const relay = new InMemoryRelay();
const teammate = process.env.PIGEON_USER ?? "local";
const gateway = new Gateway(teammate, relay, { run: async d => ({ summary: `Delegation ${d.id} accepted; configure PIGEON_CODEX_COMMAND for execution.` }) });
const server = new McpServer({ name: "pigeon", version: "0.1.0" }, { instructions: "Use Pigeon only for explicit teammate delegation. Open the inbox to review requests. Approval always requires native confirmation." });
const UI = "ui://pigeon/inbox-v1.html";
const result = (data: unknown, message: string, ui = false) => ({ structuredContent: data as Record<string, unknown>, content: [{ type: "text" as const, text: message }], ...(ui ? { _meta: { ui: { resourceUri: UI }, "openai/outputTemplate": UI } } : {}) });

server.registerResource("pigeon-inbox", new ResourceTemplate(UI, { list: undefined }), { mimeType: "text/html;profile=mcp-app", _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true }, "openai/widgetDescription": "Approval-gated teammate delegation inbox" } }, async uri => ({ contents: [{ uri: uri.href, mimeType: "text/html;profile=mcp-app", text: widgetHtml }] }));

server.registerTool("open_pigeon_inbox", { title: "Open Pigeon inbox", description: "Use this when the user wants to review teammate delegation requests.", inputSchema: {}, annotations: { readOnlyHint: true }, _meta: { ui: { resourceUri: UI }, "openai/outputTemplate": UI } }, async () => result({ delegations: gateway.inbox() }, "Opened Pigeon inbox.", true));
server.registerTool("list_teammates", { description: "Use this when the user wants to see available delegation teammates.", inputSchema: {}, annotations: { readOnlyHint: true } }, async () => result({ teammates: [teammate] }, "Listed teammates."));
server.registerTool("delegate_to_teammate", { description: "Use this when the user explicitly asks another teammate's Codex to perform bounded work.", inputSchema: { recipient: z.string(), objective: z.string(), workspace: z.string(), requestedScope: ScopeSchema }, annotations: { readOnlyHint: false, openWorldHint: true } }, async args => { const d = gateway.delegate(args.recipient, args.objective, args.workspace, args.requestedScope); return result({ delegation: d }, `Delegation ${d.id} is waiting for ${d.recipient}.`); });
server.registerTool("get_delegation", { description: "Use this when checking a delegation's current state.", inputSchema: { id: z.string() }, annotations: { readOnlyHint: true } }, async ({ id }) => result({ delegation: gateway.get(id) ?? null }, "Read delegation."));
server.registerTool("reject_delegation", { description: "Use this from the embedded inbox when the recipient rejects a request.", inputSchema: { id: z.string() }, annotations: { destructiveHint: true }, _meta: { ui: { visibility: ["app"] } } }, async ({ id }) => { gateway.reject(id); return result({ ok: true }, "Rejected delegation."); });
server.registerTool("prepare_approval", { description: "Use this only from the Pigeon inbox to narrow scope and request native confirmation.", inputSchema: { id: z.string(), effectiveScope: ScopeSchema }, annotations: { readOnlyHint: false, openWorldHint: true }, _meta: { ui: { visibility: ["app"] } } }, async ({ id, effectiveScope }) => {
  const prepared = gateway.prepareApproval(id, effectiveScope);
  const c = prepared.confirmation;
  const answer = await server.server.elicitInput({ mode: "form", message: `Approve ${c.sender}'s Codex delegation? Objective: ${c.objective} | Workspace: ${c.workspace} | Authority: ${c.effectiveScope}`, requestedSchema: { type: "object", properties: { confirm: { type: "boolean", title: "Grant this authority" } }, required: ["confirm"] } });
  if (answer.action !== "accept" || answer.content?.confirm !== true) return result({ confirmed: false }, "Approval cancelled.");
  const run = await gateway.confirmApproval(id, prepared.capability);
  return result({ confirmed: true, delegation: gateway.get(id), result: run }, "Delegation approved and completed.");
});

if (process.argv[1] && readFileSync(process.argv[1], "utf8").includes("new McpServer")) await server.connect(new StdioServerTransport());
