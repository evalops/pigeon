import { z } from "zod";
import { ScopeSchema, StateSchema } from "../protocol.js";

export const ActorSchema = z.object({ organizationId: z.string().min(1), userId: z.string().min(1), deviceId: z.string().min(1), source: z.enum(["codex", "slack", "system"]) });
export type Actor = z.infer<typeof ActorSchema>;

export const CreateDelegationInputSchema = z.object({
  recipientId: z.string().min(1), objective: z.string().min(1).max(4000), workspaceLabel: z.string().min(1).max(120),
  requestedScope: ScopeSchema, idempotencyKey: z.string().min(8), expiresAt: z.number().int().positive()
}).superRefine((value, ctx) => { if (value.workspaceLabel.includes("/") || value.workspaceLabel.includes("\\")) ctx.addIssue({ code: "custom", message: "invalid_workspace_label" }); });
export type CreateDelegationInput = z.infer<typeof CreateDelegationInputSchema>;

export const RelayDelegationSchema = CreateDelegationInputSchema.safeExtend({
  id: z.string().uuid(), organizationId: z.string(), senderId: z.string(), state: StateSchema,
  effectiveScope: ScopeSchema.optional(), version: z.number().int().positive(), createdAt: z.number().int(), updatedAt: z.number().int()
});
export type RelayDelegation = z.infer<typeof RelayDelegationSchema>;

export const RelayCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approve"), effectiveScope: ScopeSchema }), z.object({ type: z.literal("reject") }),
  z.object({ type: z.literal("start") }), z.object({ type: z.literal("complete") }), z.object({ type: z.literal("fail") }), z.object({ type: z.literal("cancel") })
]);
export type RelayCommand = z.infer<typeof RelayCommandSchema>;

export type RelayEvent = { sequence: number; delegationId: string; organizationId: string; recipientId: string; type: "created" | RelayCommand["type"]; version: number; actor: Actor; createdAt: number };
export type CreateResult = { delegation: RelayDelegation; event: RelayEvent };
export type DeviceIdentity = { id: string; organizationId: string; userId: string; publicKey: string; revokedAt?: number };
