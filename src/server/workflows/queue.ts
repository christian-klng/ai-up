import { Queue } from "bullmq";
import IORedis from "ioredis";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { workflows } from "@/server/db/schema";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { scheduleToRepeat, type ScheduleConfig } from "./triggers";

/**
 * BullMQ queue "workflow-runs": jobs of three kinds
 *  - { kind: "run", runId }                  → execute an already created run
 *  - { kind: "schedule", workflowId }        → repeatable job (job scheduler) → creates + executes a run
 *  - { kind: "evaluate", contentId, versionId } → LLM check of an entry against its template criteria
 * Web enqueues; the worker consumes (see worker/index.ts).
 */
export const WORKFLOW_QUEUE = "workflow-runs";
export type WorkflowJob = { kind: "run"; runId: string } | { kind: "schedule"; workflowId: string } | { kind: "evaluate"; contentId: string; versionId: string };

const g = globalThis as unknown as { __aiupQueue?: Queue<WorkflowJob>; __aiupQueueConn?: IORedis };

export function getQueue(): Queue<WorkflowJob> {
  if (!g.__aiupQueue) {
    g.__aiupQueueConn = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    g.__aiupQueue = new Queue<WorkflowJob>(WORKFLOW_QUEUE, {
      connection: g.__aiupQueueConn,
      defaultJobOptions: { removeOnComplete: 500, removeOnFail: 1000, attempts: 1 },
    });
  }
  return g.__aiupQueue;
}

export async function enqueueRun(runId: string): Promise<void> {
  await getQueue().add("run", { kind: "run", runId }, { jobId: `run-${runId}` });
}

/**
 * Queues an entry evaluation. Best effort: saving an entry must never fail because Redis hiccuped.
 * The job id dedupes repeated requests for the same version (e.g. re-check while one is still queued).
 */
export async function enqueueEvaluation(contentId: string, versionId: string): Promise<void> {
  try {
    // removeOnComplete/Fail frees the job id again – otherwise a later re-check of the same
    // version would be swallowed as a duplicate. Outcomes are logged and stored in the DB anyway.
    await getQueue().add("evaluate", { kind: "evaluate", contentId, versionId }, { jobId: `eval-${versionId}`, removeOnComplete: true, removeOnFail: true });
  } catch (err) {
    logger.warn({ err, contentId, versionId }, "could not enqueue entry evaluation");
  }
}

// BullMQ forbids ":" in custom ids
const schedulerId = (workflowId: string) => `wf-${workflowId}`;

/**
 * Reconciles BullMQ job schedulers with active schedule-trigger workflows.
 * Idempotent; called after every workflow change and on worker start.
 */
export async function syncSchedules(): Promise<void> {
  const queue = getQueue();
  const active = await db.query.workflows.findMany({ where: eq(workflows.status, "active") });
  const wanted = new Map<string, ScheduleConfig>();
  for (const w of active) if (w.trigger.type === "schedule") wanted.set(w.id, w.trigger.config as ScheduleConfig);

  const existing = await queue.getJobSchedulers(0, 1000);
  for (const s of existing) {
    if (!s.key.startsWith("wf-")) continue;
    const wfId = s.key.slice(3);
    if (!wanted.has(wfId)) {
      await queue.removeJobScheduler(s.key);
      logger.info({ workflowId: wfId }, "schedule removed");
    }
  }
  for (const [wfId, cfg] of wanted) {
    const repeat = scheduleToRepeat(cfg);
    // upsert replaces the schedule when pattern/every changed
    await queue.upsertJobScheduler(schedulerId(wfId), repeat, { name: "schedule", data: { kind: "schedule", workflowId: wfId }, opts: { removeOnComplete: 100, removeOnFail: 100 } });
  }
  logger.debug({ count: wanted.size }, "schedules synced");
}

export async function nextScheduledRun(workflowId: string): Promise<Date | null> {
  const s = await getQueue().getJobScheduler(schedulerId(workflowId));
  return s?.next ? new Date(s.next) : null;
}
