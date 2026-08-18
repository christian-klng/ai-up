import { access, constants, mkdir } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { uploadRoot } from "@/server/media/storage";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe for Coolify: DB reachable + upload volume writable. */
export async function GET() {
  const checks: Record<string, "ok" | string> = {};
  try {
    await db.execute(sql`select 1`);
    checks.database = "ok";
  } catch (e) {
    checks.database = e instanceof Error ? e.message : "error";
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
