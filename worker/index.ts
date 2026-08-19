/**
 * Background worker (BullMQ): executes workflow runs and schedule triggers.
 * Shares src/server/** with the web process; never imports next/* or React.
 */
import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { eq } from "drizzle-orm";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { db, pool } from "@/server/db/client";
import { workflows } from "@/server/db/schema";
import { WORKFLOW_QUEUE, getQueue, syncSchedules, type WorkflowJob } from "@/server/workflows/queue";
import { createRun, executeRun } from "@/server/workflows/engine";
import { loadRegistry } from "@/server/workflows/registry";

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

async function processJob(job: Job<WorkflowJob>): Promise<void> {
  const data = job.data;
  if (data.kind === "run") {
    await executeRun(data.runId);
    return;
  }
  if (data.kind === "schedule") {
    const wf = await db.query.workflows.findFirst({ where: eq(workflows.id, data.workflowId) });
    if (!wf || wf.status !== "active" || wf.trigger.type !== "schedule") {
      logger.info({ workflowId: data.workflowId }, "schedule job for inactive/missing workflow – ignoring");
      return;
    }
    const now = new Date();
    const run = await createRun(wf, { scheduledFor: job.processedOn ? new Date(job.timestamp).toISOString() : now.toISOString(), firedAt: now.toISOString() });
    if (run) await executeRun(run.id);
  }
}

async function main() {
  await pool.query("select 1");
  logger.info({ redis: env.REDIS_URL.replace(/\/\/.*@/, "//***@") }, "worker: database and redis reachable");

  await loadRegistry();
  await syncSchedules();
  // Re-sync periodically in case a web instance changed schedules while we were down.
  const resync = setInterval(() => void syncSchedules().catch((err) => logger.warn({ err }, "schedule resync failed")), 5 * 60_000);

  const worker = new Worker<WorkflowJob>(WORKFLOW_QUEUE, processJob, {
    connection,
    concurrency: env.WORKFLOW_CONCURRENCY,
    lockDuration: 5 * 60_000,
  });
  worker.on("failed", (job, err) => logger.error({ jobId: job?.id, data: job?.data, err }, "workflow job failed"));
  worker.on("error", (err) => logger.error({ err }, "worker error"));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker: shutting down");
    clearInterval(resync);
    await worker.close();
    await getQueue().close();
    await connection.quit();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  logger.info({ concurrency: env.WORKFLOW_CONCURRENCY }, "worker: ready");
}

main().catch((err) => {
  logger.error({ err }, "worker: fatal");
  process.exit(1);
});
