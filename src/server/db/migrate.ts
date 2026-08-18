/**
 * Runs pending drizzle migrations from ./drizzle, then seeds baseline data.
 * Used by `npm run db:migrate` (tsx) and by docker/entrypoint.sh (bundled to dist/).
 */
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";
import { seed } from "./seed";

async function main() {
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  await seed(db);
  console.log("[migrate] done");
}

main()
  .catch((err) => {
    console.error("[migrate] failed", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
