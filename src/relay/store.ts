import type { Actor, CreateDelegationInput, CreateResult, RelayCommand, RelayDelegation, RelayEvent } from "./types.js";

export interface RelayStore {
  createDelegation(input: CreateDelegationInput, actor: Actor): Promise<CreateResult>;
  get(id: string, organizationId: string, userId: string): Promise<RelayDelegation | undefined>;
  events(organizationId: string, recipientId: string, after: number): Promise<RelayEvent[]>;
  transition(id: string, expectedVersion: number, command: RelayCommand, actor: Actor): Promise<RelayDelegation>;
}
