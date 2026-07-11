import { z } from "zod";

export const ScopeSchema = z.enum(["discuss_only", "read_only", "workspace_write"]);
export type Scope = z.infer<typeof ScopeSchema>;
export const StateSchema = z.enum(["pending", "approved", "running", "completed", "rejected", "cancelled", "failed"]);
export type DelegationState = z.infer<typeof StateSchema>;
export type DelegationAction = "approve" | "start" | "complete" | "reject" | "cancel" | "fail";

const rank: Record<Scope, number> = { discuss_only: 0, read_only: 1, workspace_write: 2 };

export function canNarrowScope(requested: Scope, effective: Scope): boolean {
  return rank[effective] <= rank[requested];
}

const transitions: Partial<Record<DelegationState, Partial<Record<DelegationAction, DelegationState>>>> = {
  pending: { approve: "approved", reject: "rejected", cancel: "cancelled" },
  approved: { start: "running", cancel: "cancelled", fail: "failed" },
  running: { complete: "completed", cancel: "cancelled", fail: "failed" }
};

export function transition(state: DelegationState, action: DelegationAction): DelegationState {
  const next = transitions[state]?.[action];
  if (!next) throw new Error(`invalid_transition:${state}:${action}`);
  return next;
}

export const DelegationSchema = z.object({
  id: z.string().min(1), sender: z.string().min(1), recipient: z.string().min(1),
  objective: z.string().min(1).max(4000), workspace: z.string().min(1),
  requestedScope: ScopeSchema, effectiveScope: ScopeSchema.optional(), state: StateSchema,
  createdAt: z.number().int(), expiresAt: z.number().int(), idempotencyKey: z.string().min(8)
});
export type Delegation = z.infer<typeof DelegationSchema>;
