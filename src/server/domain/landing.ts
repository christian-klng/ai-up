import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { landingPageVersions, mediaFiles, users, type LandingPageVersion, type MediaFile } from "@/server/db/schema";
import { validateLandingDefinition, collectLandingMediaIds, type LandingDefinition, type LandingValidationIssue } from "@/lib/landing-schema";

/**
 * Landing page domain: a singleton definition stored as append-only versions
 * (current = highest version, restore = copy-forward – same principle as content/workflow versions).
 */

export type LandingVersionListItem = Pick<LandingPageVersion, "id" | "version" | "source" | "changeNote" | "createdAt"> & {
  changedByName: string | null;
};

export async function getCurrentLandingVersion(): Promise<LandingPageVersion | undefined> {
  return db.query.landingPageVersions.findFirst({ orderBy: desc(landingPageVersions.version) });
}

export async function getLandingVersion(version: number): Promise<LandingPageVersion | undefined> {
  return db.query.landingPageVersions.findFirst({ where: eq(landingPageVersions.version, version) });
}

export async function listLandingVersions(limit = 50): Promise<LandingVersionListItem[]> {
  const rows = await db
    .select({
      id: landingPageVersions.id,
      version: landingPageVersions.version,
      source: landingPageVersions.source,
      changeNote: landingPageVersions.changeNote,
      createdAt: landingPageVersions.createdAt,
      changedByName: users.name,
    })
    .from(landingPageVersions)
    .leftJoin(users, eq(users.id, landingPageVersions.changedBy))
    .orderBy(desc(landingPageVersions.version))
    .limit(limit);
  return rows;
}

export type LandingMediaItem = Pick<MediaFile, "id" | "originalName" | "mime" | "size" | "width" | "height" | "createdAt">;

/** Publicly served images usable on the landing page (purpose "landing"). */
export async function listLandingMedia(): Promise<LandingMediaItem[]> {
  return db
    .select({
      id: mediaFiles.id,
      originalName: mediaFiles.originalName,
      mime: mediaFiles.mime,
      size: mediaFiles.size,
      width: mediaFiles.width,
      height: mediaFiles.height,
      createdAt: mediaFiles.createdAt,
    })
    .from(mediaFiles)
    .where(eq(mediaFiles.purpose, "landing"))
    .orderBy(desc(mediaFiles.createdAt))
    .limit(100);
}

export type SaveLandingResult =
  | { ok: true; row: LandingPageVersion; warnings: string[] }
  | { ok: false; issues: LandingValidationIssue[] };

/** Validates and appends a new version (hard gate for UI and MCP alike). */
export async function saveLandingVersion(
  definition: unknown,
  actorId: string,
  source: "ui" | "mcp",
  changeNote?: string | null,
): Promise<SaveLandingResult> {
  const validated = validateLandingDefinition(definition);
  if (!validated.ok) return { ok: false, issues: validated.issues };
  const warnings = await mediaWarnings(validated.definition);
  const row = await insertNextVersion(validated.definition, actorId, source, changeNote ?? null);
  return { ok: true, row, warnings };
}

/** Restores an older version by copying it forward as a new version (history stays intact). */
export async function restoreLandingVersion(
  version: number,
  actorId: string,
  source: "ui" | "mcp",
  note?: string | null,
): Promise<LandingPageVersion | undefined> {
  const v = await getLandingVersion(version);
  if (!v) return undefined;
  return insertNextVersion(v.definition, actorId, source, note ?? `restored version ${version}`);
}

async function insertNextVersion(definition: LandingDefinition, actorId: string, source: "ui" | "mcp", changeNote: string | null) {
  // The unique index on version catches concurrent writers; one retry is enough for this low-traffic table.
  for (let attempt = 0; ; attempt++) {
    const current = await getCurrentLandingVersion();
    try {
      const [row] = await db
        .insert(landingPageVersions)
        .values({ version: (current?.version ?? 0) + 1, definition, source, changeNote, changedBy: actorId })
        .returning();
      return row;
    } catch (err) {
      if (attempt >= 1) throw err;
    }
  }
}

/** Warns about referenced media that will not load on the public page (wrong purpose or missing). */
async function mediaWarnings(definition: LandingDefinition): Promise<string[]> {
  const ids = collectLandingMediaIds(definition);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: mediaFiles.id, purpose: mediaFiles.purpose })
    .from(mediaFiles)
    .where(inArray(mediaFiles.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r.purpose]));
  const warnings: string[] = [];
  for (const id of ids) {
    const purpose = byId.get(id);
    if (!purpose) warnings.push(`media ${id} does not exist`);
    else if (purpose !== "landing" && purpose !== "logo") {
      warnings.push(`media ${id} has purpose "${purpose}" and is not publicly served – upload landing images via the admin landing page`);
    }
  }
  return warnings;
}
