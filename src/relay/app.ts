import express, { type Request } from "express";
import { z } from "zod";
import type { RelayStore } from "./store.js";
import { NonceStore, verifyDeviceRequest } from "./auth.js";
import { CreateDelegationInputSchema, type Actor, type DeviceIdentity } from "./types.js";
import { parseSlackAction, verifySlackRequest } from "../slack/actions.js";
import type { EnrollmentService } from "../enrollment/service.js";
import type { SlackOidcClient } from "../enrollment/slack-oidc.js";

type Options = { store: RelayStore; devices: Map<string, DeviceIdentity>; clock?: () => number; slackInternalSecret?: string; slackSigningSecret?: string; enrollment?: EnrollmentService; oidc?: Pick<SlackOidcClient, "authorizationUrl" | "exchange"> };
const TransitionBody = z.object({ expectedVersion: z.number().int().positive(), effectiveScope: z.enum(["discuss_only", "read_only", "workspace_write"]).optional(), summary: z.string().max(4000).optional(), threadId: z.string().max(200).optional() });
const errorStatus: Record<string, number> = { not_found: 404, expired: 410, version_conflict: 409, scope_widening: 403, invalid_transition: 409, replay: 401, stale_request: 401, invalid_signature: 401, unauthorized: 401, codex_confirmation_required: 403 };

export function createRelayApp({ store, devices, clock = Date.now, slackInternalSecret, slackSigningSecret, enrollment, oidc }: Options) {
  const app = express(); const nonces = new NonceStore();
  app.post("/v1/slack/actions", express.text({ type: "application/x-www-form-urlencoded", limit: "32kb" }), async (req, res, next) => {
    try {
      if (!slackSigningSecret) throw new Error("unauthorized"); const raw = String(req.body); const timestamp = Number(req.header("x-slack-request-timestamp")); verifySlackRequest(raw, timestamp, String(req.header("x-slack-signature") ?? ""), slackSigningSecret, Math.floor(clock() / 1000));
      const action = parseSlackAction(raw); if (action.action === "open") return res.json({ ok: true, open: action.delegationId }); const current = await store.get(action.delegationId, action.organizationId, action.userId); if (!current) throw new Error("not_found");
      if (action.action === "approve" && current.requestedScope !== "discuss_only") throw new Error("codex_confirmation_required"); const actor = { organizationId: action.organizationId, userId: action.userId, deviceId: "slack", source: "slack" as const };
      const command = action.action === "approve" ? { type: "approve" as const, effectiveScope: "discuss_only" as const } : { type: "reject" as const }; await store.transition(current.id, current.version, command, actor); return res.json({ ok: true });
    } catch (error) { next(error); }
  });
  app.use(express.json({ limit: "32kb" }));
  app.post("/v1/enrollment/start", async (req, res, next) => {
    try { if (!enrollment || !oidc) throw new Error("enrollment_unavailable"); const input = z.object({ deviceId: z.string(), publicKey: z.string(), redirectUri: z.string().url(), teamId: z.string().optional() }).parse(req.body); const pending = await enrollment.start(input); const authorizeUrl = oidc.authorizationUrl({ state: pending.state, nonce: pending.nonce, redirectUri: input.redirectUri, teamId: input.teamId }); res.status(201).json({ authorizeUrl: authorizeUrl.href, expiresAt: pending.expiresAt }); } catch (error) { next(error); }
  });
  app.get("/v1/enrollment/callback", async (req, res, next) => {
    try { if (!enrollment || !oidc) throw new Error("enrollment_unavailable"); const state = String(req.query.state ?? ""); const code = String(req.query.code ?? ""); const pending = await enrollment.inspect(state); const identity = await oidc.exchange({ code, redirectUri: pending.redirectUri }); const device = await enrollment.complete(state, identity); devices.set(device.id, device); res.type("html").send("<!doctype html><title>Pigeon enrolled</title><p>Pigeon device enrolled. You can close this window.</p>"); } catch (error) { next(error); }
  });
  app.get("/healthz", (_req, res) => { res.json({ ok: true }); });

  const deviceActor = (req: Request): Actor => {
    const id = String(req.header("x-pigeon-device") ?? ""); const device = devices.get(id); if (!device || device.revokedAt) throw new Error("unauthorized");
    const timestamp = Number(req.header("x-pigeon-timestamp")); const nonce = String(req.header("x-pigeon-nonce") ?? ""); const signature = String(req.header("x-pigeon-signature") ?? "");
    verifyDeviceRequest({ method: req.method, path: req.originalUrl, timestamp, nonce, body: req.body ?? null, signature }, device.publicKey, nonces, clock());
    return { organizationId: device.organizationId, userId: device.userId, deviceId: device.id, source: "codex" };
  };
  const transitionActor = (req: Request) => {
    if (req.header("x-pigeon-slack-secret")) {
      if (!slackInternalSecret || req.header("x-pigeon-slack-secret") !== slackInternalSecret) throw new Error("unauthorized");
      return { organizationId: String(req.header("x-pigeon-organization")), userId: String(req.header("x-pigeon-slack-user")), deviceId: "slack", source: "slack" as const };
    }
    return deviceActor(req);
  };

  app.post("/v1/delegations", async (req, res, next) => { try { const actor = deviceActor(req); const result = await store.createDelegation(CreateDelegationInputSchema.parse(req.body), actor); res.status(201).json(result); } catch (error) { next(error); } });
  app.get("/v1/delegations/:id", async (req, res, next) => { try { const actor = deviceActor(req); const delegation = await store.get(req.params.id!, actor.organizationId, actor.userId); if (!delegation) throw new Error("not_found"); res.json({ delegation }); } catch (error) { next(error); } });
  app.get("/v1/events", async (req, res, next) => { try { const actor = deviceActor(req); res.json({ events: await store.events(actor.organizationId, actor.userId, Number(req.query.after ?? 0)) }); } catch (error) { next(error); } });
  for (const action of ["approve", "reject", "start", "complete", "fail", "cancel"] as const) app.post(`/v1/delegations/:id/${action}`, async (req, res, next) => {
    try {
      const actor = transitionActor(req); const body = TransitionBody.parse(req.body); if (action === "approve" && actor.source === "slack" && body.effectiveScope !== "discuss_only") throw new Error("codex_confirmation_required");
      const command = action === "approve" ? { type: action, effectiveScope: body.effectiveScope ?? "discuss_only" } as const : action === "complete" ? { type: action, summary: body.summary, threadId: body.threadId } as const : { type: action } as const;
      res.json({ delegation: await store.transition(req.params.id!, body.expectedVersion, command, actor) });
    } catch (error) { next(error); }
  });
  app.use((error: unknown, _req: Request, res: express.Response, _next: express.NextFunction) => { const raw = error instanceof Error ? error.message : "internal_error"; const code = raw.startsWith("invalid_transition") ? "invalid_transition" : raw; res.status(errorStatus[code] ?? (error instanceof z.ZodError ? 400 : 500)).json({ error: { code } }); });
  return app;
}
