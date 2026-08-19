import type { ActionDefinition, TriggerDefinition } from "./types";

/**
 * Central registry. Triggers/actions register themselves on import (see ./triggers/index.ts, ./actions/index.ts).
 * `loadRegistry()` must be called once per process before using lookups (web: instrumentation, worker: main).
 */
const triggers = new Map<string, TriggerDefinition>();
const actions = new Map<string, ActionDefinition>();

export function registerTrigger<C>(def: TriggerDefinition<C>): void {
  triggers.set(def.type, def as unknown as TriggerDefinition);
}
export function registerAction<C>(def: ActionDefinition<C>): void {
  actions.set(def.type, def as unknown as ActionDefinition);
}

export function getTrigger(type: string): TriggerDefinition | undefined {
  return triggers.get(type);
}
export function getAction(type: string): ActionDefinition | undefined {
  return actions.get(type);
}
export function listTriggers(): TriggerDefinition[] {
  return [...triggers.values()];
}
export function listActions(): ActionDefinition[] {
  return [...actions.values()];
}
export function triggersForEvent(eventType: string): TriggerDefinition[] {
  return listTriggers().filter((t) => t.eventTypes?.includes(eventType));
}

let loaded = false;
/** Imports all built-in triggers/actions exactly once. */
export async function loadRegistry(): Promise<void> {
  if (loaded) return;
  loaded = true;
  await import("./triggers");
  await import("./actions");
}
