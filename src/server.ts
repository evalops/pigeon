import { readFileSync } from "node:fs";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AgentKitClient } from "@evalops/agent-kit";
import { Gateway } from "./gateway.js";
import { ScopeSchema } from "./protocol.js";
import { widgetHtml } from "./widget.js";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; enroll Agent Kit and configure Pigeon with stable principal coordinates.`);
  return value;
};
const teammate = required("PIGEON_USER_PRINCIPAL_ID");
const gateway = new Gateway({
  organizationId: required("PIGEON_ORGANIZATION_ID"),
  workspaceId: required("PIGEON_WORKSPACE_ID"),
  userPrincipalId: teammate,
  devicePrincipalId: required("PIGEON_DEVICE_PRINCIPAL_ID"),
}, new AgentKitClient({ socketPath: process.env.EVALOPS_AGENT_SOCKET ?? "/tmp/evalops-agent-kit.sock" }));
const server = new McpServer({ name: "pigeon", version: "0.1.0" }, { instructions: "Use Pigeon only for explicit teammate delegation. Open the inbox to review requests. Approval always requires native confirmation." });
const UI = "ui://pigeon/inbox-v1.html";
const result = (data: unknown, message: string, ui = false) => ({ structuredContent: data as Record<string, unknown>, content: [{ type: "text" as const, text: message }], ...(ui ? { _meta: { ui: { resourceUri: UI }, "openai/outputTemplate": UI } } : {}) });

server.registerResource("pigeon-inbox", new ResourceTemplate(UI, { list: undefined }), { mimeType: "text/html;profile=mcp-app", _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true }, "openai/widgetDescription": "Approval-gated teammate delegation inbox" } }, async uri => ({ contents: [{ uri: uri.href, mimeType: "text/html;profile=mcp-app", text: widgetHtml }] }));

server.registerTool("open_pigeon_inbox", { title: "Open Pigeon inbox", description: "Use this when the user wants to review teammate delegation requests.", inputSchema: {}, annotations: { readOnlyHint: true }, _meta: { ui: { resourceUri: UI }, "openai/outputTemplate": UI } }, async () => result({ delegations: await gateway.inbox() }, "Opened Pigeon inbox.", true));
server.registerTool("list_teammates", { description: "Use this when the user wants to see available delegation teammates.", inputSchema: {}, annotations: { readOnlyHint: true } }, async () => result({ teammates: [teammate] }, "Listed teammates."));
server.registerTool("delegate_to_teammate", { description: "Use this when the user explicitly asks another teammate's Codex to perform bounded work.", inputSchema: { recipient: z.string(), objective: z.string(), workspace: z.string(), requestedScope: ScopeSchema }, annotations: { readOnlyHint: false, openWorldHint: true } }, async args => { const d = await gateway.delegate(args.recipient, args.objective, args.workspace, args.requestedScope); return result({ delegation: d }, `Delegation ${d.id} is waiting for ${d.recipient}.`); });
server.registerTool("get_delegation", { description: "Use this when checking a delegation's current state.", inputSchema: { id: z.string() }, annotations: { readOnlyHint: true } }, async ({ id }) => result({ delegation: await gateway.get(id) ?? null }, "Read delegation."));
server.registerTool("reject_delegation", { description: "Use this from the embedded inbox when the recipient rejects a request.", inputSchema: { id: z.string() }, annotations: { destructiveHint: true }, _meta: { ui: { visibility: ["app"] } } }, async ({ id }) => { await gateway.reject(id); return result({ ok: true }, "Rejected delegation."); });
server.registerTool("prepare_approval", { description: "Use this only from the Pigeon inbox to narrow scope and request native confirmation.", inputSchema: { id: z.string(), effectiveScope: ScopeSchema }, annotations: { readOnlyHint: false, openWorldHint: true }, _meta: { ui: { visibility: ["app"] } } }, async ({ id, effectiveScope }) => {
  const prepared = await gateway.prepareApproval(id, effectiveScope);
  const c = prepared.confirmation;
  const answer = await server.server.elicitInput({ mode: "form", message: `Approve ${c.sender}'s Codex delegation? Objective: ${c.objective} | Workspace: ${c.workspace} | Authority: ${c.effectiveScope}`, requestedSchema: { type: "object", properties: { confirm: { type: "boolean", title: "Grant this authority" } }, required: ["confirm"] } });
  if (answer.action !== "accept" || answer.content?.confirm !== true) return result({ confirmed: false }, "Approval cancelled.");
  const delegation = await gateway.confirmApproval(id, effectiveScope);
  return result({ confirmed: true, delegation }, "Delegation approved. Agent Kit will execute it under the confirmed authority.");
});

if (process.argv[1] && readFileSync(process.argv[1], "utf8").includes("new McpServer")) await server.connect(new StdioServerTransport());
