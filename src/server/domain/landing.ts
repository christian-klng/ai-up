import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { landingPageVersions, mediaFiles, users, type AppSettings, type LandingPageVersion, type MediaFile } from "@/server/db/schema";
import { validateLandingDefinition, collectLandingMediaIds, type LandingDefinition, type LandingValidationIssue, type SitePage } from "@/lib/landing-schema";

/**
 * Public site pages domain (landing, imprint, privacy): one definition per page stored as
 * append-only versions (current = highest version, restore = copy-forward – same principle
 * as content/workflow versions). All pages share the schema and the "landing" image pool.
 */

export type LandingVersionListItem = Pick<LandingPageVersion, "id" | "version" | "source" | "changeNote" | "createdAt"> & {
  changedByName: string | null;
};

/** Whether a page is publicly served, from the per-page flags on app_settings. */
export function isPageEnabled(settings: Pick<AppSettings, "landingEnabled" | "imprintEnabled" | "privacyEnabled">, page: SitePage): boolean {
  return page === "landing" ? settings.landingEnabled : page === "imprint" ? settings.imprintEnabled : settings.privacyEnabled;
}

/** The app_settings column holding the enabled flag for a page. */
export function pageEnabledColumn(page: SitePage): "landingEnabled" | "imprintEnabled" | "privacyEnabled" {
  return page === "landing" ? "landingEnabled" : page === "imprint" ? "imprintEnabled" : "privacyEnabled";
}

export async function getCurrentLandingVersion(page: SitePage): Promise<LandingPageVersion | undefined> {
  return db.query.landingPageVersions.findFirst({ where: eq(landingPageVersions.page, page), orderBy: desc(landingPageVersions.version) });
}

export async function getLandingVersion(page: SitePage, version: number): Promise<LandingPageVersion | undefined> {
  return db.query.landingPageVersions.findFirst({ where: and(eq(landingPageVersions.page, page), eq(landingPageVersions.version, version)) });
}

export async function listLandingVersions(page: SitePage, limit = 50): Promise<LandingVersionListItem[]> {
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
    .where(eq(landingPageVersions.page, page))
    .orderBy(desc(landingPageVersions.version))
    .limit(limit);
  return rows;
}

export type LandingMediaItem = Pick<MediaFile, "id" | "originalName" | "mime" | "size" | "width" | "height" | "createdAt">;

/** Publicly served images usable on any site page (purpose "landing" – one shared pool). */
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

/** Validates and appends a new version for one page (hard gate for UI and MCP alike). */
export async function saveLandingVersion(
  page: SitePage,
  definition: unknown,
  actorId: string,
  source: "ui" | "mcp",
  changeNote?: string | null,
): Promise<SaveLandingResult> {
  const validated = validateLandingDefinition(definition);
  if (!validated.ok) return { ok: false, issues: validated.issues };
  const warnings = await mediaWarnings(validated.definition);
  const row = await insertNextVersion(page, validated.definition, actorId, source, changeNote ?? null);
  return { ok: true, row, warnings };
}

/** Restores an older version by copying it forward as a new version (history stays intact). */
export async function restoreLandingVersion(
  page: SitePage,
  version: number,
  actorId: string,
  source: "ui" | "mcp",
  note?: string | null,
): Promise<LandingPageVersion | undefined> {
  const v = await getLandingVersion(page, version);
  if (!v) return undefined;
  return insertNextVersion(page, v.definition, actorId, source, note ?? `restored version ${version}`);
}

async function insertNextVersion(page: SitePage, definition: LandingDefinition, actorId: string, source: "ui" | "mcp", changeNote: string | null) {
  // The unique index on (page, version) catches concurrent writers; one retry is enough for this low-traffic table.
  for (let attempt = 0; ; attempt++) {
    const current = await getCurrentLandingVersion(page);
    try {
      const [row] = await db
        .insert(landingPageVersions)
        .values({ page, version: (current?.version ?? 0) + 1, definition, source, changeNote, changedBy: actorId })
        .returning();
      return row;
    } catch (err) {
      if (attempt >= 1) throw err;
    }
  }
}

/** Warns about referenced media that will not load on a public page (wrong purpose or missing). */
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
      warnings.push(`media ${id} has purpose "${purpose}" and is not publicly served – upload page images under Admin → Web pages`);
    }
  }
  return warnings;
}
