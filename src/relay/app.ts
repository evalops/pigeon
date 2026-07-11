import express, { type Request } from "express";
import { z } from "zod";
import type { RelayStore } from "./store.js";
import { NonceStore, verifyDeviceRequest } from "./auth.js";
import { CreateDelegationInputSchema, type Actor, type DeviceIdentity } from "./types.js";

type Options = { store: RelayStore; devices: Map<string, DeviceIdentity>; clock?: () => number; slackInternalSecret?: string };
const TransitionBody = z.object({ expectedVersion: z.number().int().positive(), effectiveScope: z.enum(["discuss_only", "read_only", "workspace_write"]).optional() });
const errorStatus: Record<string, number> = { not_found: 404, expired: 410, version_conflict: 409, scope_widening: 403, invalid_transition: 409, replay: 401, stale_request: 401, invalid_signature: 401, unauthorized: 401, codex_confirmation_required: 403 };

export function createRelayApp({ store, devices, clock = Date.now, slackInternalSecret }: Options) {
  const app = express(); const nonces = new NonceStore(); app.use(express.json({ limit: "32kb" }));
  app.get("/healthz", (_req, res) => { res.json({ ok: true }); });

  const deviceActor = (req: Request): Actor => {
    const id = String(req.header("x-pigeon-device") ?? ""); const device = devices.get(id); if (!device || device.revokedAt) throw new Error("unauthorized");
    const timestamp = Number(req.header("x-pigeon-timestamp")); const nonce = String(req.header("x-pigeon-nonce") ?? ""); const signature = String(req.header("x-pigeon-signature") ?? "");
    verifyDeviceRequest({ method: req.method, path: req.path, timestamp, nonce, body: req.body ?? null, signature }, device.publicKey, nonces, clock());
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
  app.get("/v1/events", async (req, res, next) => { try { const actor = deviceActor(req); res.json({ events: await store.events(actor.organizationId, actor.userId, Number(req.query.after ?? 0)) }); } catch (error) { next(error); } });
  for (const action of ["approve", "reject", "start", "complete", "fail", "cancel"] as const) app.post(`/v1/delegations/:id/${action}`, async (req, res, next) => {
    try {
      const actor = transitionActor(req); const body = TransitionBody.parse(req.body); if (action === "approve" && actor.source === "slack" && body.effectiveScope !== "discuss_only") throw new Error("codex_confirmation_required");
      const command = action === "approve" ? { type: action, effectiveScope: body.effectiveScope ?? "discuss_only" } as const : { type: action } as const;
      res.json({ delegation: await store.transition(req.params.id!, body.expectedVersion, command, actor) });
    } catch (error) { next(error); }
  });
  app.use((error: unknown, _req: Request, res: express.Response, _next: express.NextFunction) => { const raw = error instanceof Error ? error.message : "internal_error"; const code = raw.startsWith("invalid_transition") ? "invalid_transition" : raw; res.status(errorStatus[code] ?? (error instanceof z.ZodError ? 400 : 500)).json({ error: { code } }); });
  return app;
}
