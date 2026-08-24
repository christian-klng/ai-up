import { access, constants, mkdir } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { getRedis } from "@/server/redis";
import { uploadRoot } from "@/server/media/storage";

export const dynamic = "force-dynamic";

/**
 * The shared Redis client queues commands while it is disconnected, so a ping would wait instead of
 * failing. Racing it keeps an unreachable Redis from hanging the probe past the container's 5s timeout.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Liveness/readiness probe for Coolify: DB and Redis reachable + upload volume writable. */
export async function GET() {
  const checks: Record<string, "ok" | string> = {};
  try {
    await db.execute(sql`select 1`);
    checks.database = "ok";
  } catch (e) {
    checks.database = e instanceof Error ? e.message : "error";
  }
  try {
    await withTimeout(getRedis().ping(), 2000);
    checks.redis = "ok";
  } catch (e) {
    checks.redis = e instanceof Error ? e.message : "error";
  }
  try {
    await mkdir(uploadRoot(), { recursive: true });
    await access(uploadRoot(), constants.W_OK);
    checks.uploads = "ok";
  } catch {
    checks.uploads = "not writable";
  }
  const healthy = Object.values(checks).every((v) => v === "ok");
  return Response.json({ status: healthy ? "ok" : "degraded", checks }, { status: healthy ? 200 : 503 });
}
