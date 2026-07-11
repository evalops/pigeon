import type { PostgresRelayStore } from "../relay/postgres.js";
import type { SlackClient } from "./client.js";

type Store = Pick<PostgresRelayStore, "claimOutbox" | "get" | "completeOutbox" | "failOutbox">;
type Client = Pick<SlackClient, "postDelegation">;

export async function deliverOutboxOnce(store: Store, slack: Client) {
  const items = await store.claimOutbox(20);
  for (const item of items) {
    try {
      const event = item.payload;
      if (event.type === "created") {
        const delegation = await store.get(event.delegationId, event.organizationId, event.recipientId); if (!delegation) throw new Error("delegation_missing");
        await slack.postDelegation({ id: delegation.id, recipientSlackId: delegation.recipientId, senderLabel: delegation.senderId, objective: delegation.objective, workspaceLabel: delegation.workspaceLabel, requestedScope: delegation.requestedScope, expiresAt: delegation.expiresAt });
      }
      await store.completeOutbox(item.id);
    } catch (error) { await store.failOutbox(item.id, error instanceof Error ? error.message : "delivery_failed"); }
  }
  return items.length;
}
