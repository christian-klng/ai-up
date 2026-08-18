/**
 * Background worker entry point (BullMQ). Phase 1 only keeps the process alive and verifies
 * connectivity; queues for workflows, scheduler, Nextcloud polling and mail are added in later phases.
 */
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { pool } from "@/server/db/client";

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

async function main() {
  await pool.query("select 1");
  logger.info({ redis: env.REDIS_URL.replace(/\/\/.*@/, "//***@") }, "worker: database and redis reachable");

  // Heartbeat queue: proves the worker loop is running (visible in logs / later in admin UI).
  const heartbeat = new Queue("heartbeat", { connection });
  await heartbeat.upsertJobScheduler("heartbeat", { every: 60_000 }, { name: "tick" });
  const worker = new Worker(
    "heartbeat",
    async () => {
      logger.debug("worker heartbeat");
    },
    { connection, concurrency: 1 },
  );
  worker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "heartbeat job failed"));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker: shutting down");
    await worker.close();
    await heartbeat.close();
    await connection.quit();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  logger.info("worker: ready");
}

main().catch((err) => {
  logger.error({ err }, "worker: fatal");
  process.exit(1);
});
