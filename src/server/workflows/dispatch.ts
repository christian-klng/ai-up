import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { workflows, type Workflow } from "@/server/db/schema";
import type { DomainEvent, EventOrigin } from "@/server/events/bus";
import { logger } from "@/server/logger";
import { createRun } from "./engine";
import { enqueueRun } from "./queue";
import { loadRegistry, triggersForEvent } from "./registry";

/**
 * Connects domain events to workflow triggers: for every active workflow whose trigger listens to the
 * event type and whose config matches the payload, a run is created and enqueued.
 * Called by the event bus (see src/server/events/bus.ts) in web and worker alike.
 */
export async function dispatchEvent(event: DomainEvent): Promise<void> {
  await loadRegistry();
  const triggers = triggersForEvent(event.type);
  if (!triggers.length) return;
  const active = await db.query.workflows.findMany({ where: eq(workflows.status, "active") });
  const payload = event.payload as Record<string, unknown>;
  const origin = (payload.origin as EventOrigin | undefined) ?? { kind: "user" };
  const parent = origin.kind === "workflow" ? origin : null;
  for (const wf of active) {
    const trigger = triggers.find((t) => t.type === wf.trigger.type);
    if (!trigger) continue;
    const cfg = trigger.configSchema.safeParse(wf.trigger.config);
    if (!cfg.success) continue;
    if (trigger.matches && !trigger.matches(cfg.data as Record<string, unknown>, payload)) continue;
    // Loop guard: a workflow never re-triggers itself through its own side effects
    if (parent && parent.workflowId === wf.id) continue;
    await startRun(wf, payload, { triggeredBy: (payload.actorId as string | null) ?? null, parentRunId: parent?.runId ?? null, depth: parent ? parent.depth : 0 });
  }
}

/** Creates a run row and enqueues it for the worker. */
export async function startRun(workflow: Workflow, triggerEvent: Record<string, unknown>, opts: { triggeredBy?: string | null; parentRunId?: string | null; depth?: number } = {}): Promise<string | undefined> {
  const run = await createRun(workflow, triggerEvent, opts);
  if (!run) return undefined;
  await enqueueRun(run.id);
  logger.info({ runId: run.id, workflowId: workflow.id, trigger: workflow.trigger.type }, "workflow run enqueued");
  return run.id;
}
