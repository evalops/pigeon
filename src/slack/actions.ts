import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const PayloadSchema = z.object({ team: z.object({ id: z.string() }), user: z.object({ id: z.string() }), actions: z.array(z.object({ action_id: z.enum(["approve_discuss", "reject", "open_codex"]), value: z.string().min(1) })).length(1) });

export function verifySlackRequest(rawBody: string, timestamp: number, signature: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  if (Math.abs(now - timestamp) > 300) throw new Error("stale_slack_request"); const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const actualBuffer = Buffer.from(signature); const expectedBuffer = Buffer.from(expected); if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) throw new Error("invalid_slack_signature"); return true;
}

export function parseSlackAction(rawBody: string) {
  const form = new URLSearchParams(rawBody); const payload = PayloadSchema.parse(JSON.parse(form.get("payload") ?? "null")); const selected = payload.actions[0]!;
  return { action: selected.action_id === "approve_discuss" ? "approve" as const : selected.action_id === "open_codex" ? "open" as const : "reject" as const, delegationId: selected.value, organizationId: payload.team.id, userId: payload.user.id };
}
