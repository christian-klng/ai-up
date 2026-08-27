import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, contentTemplateVersions, contentTemplates, knowledgeAreaTemplates, type ContentTemplate, type ContentTemplateVersion } from "@/server/db/schema";
import type { StructureDefinition } from "@/lib/structures/types";
import { SYSTEM_TEMPLATE_IDS, type SystemTemplateKey } from "@/lib/structures/defaults";

// ---------------------------------------------------------------------------
// Content templates ("Vorlagen"): standalone, admin-managed structure
// definitions, versioned like the old collection structures (snapshot per
// save). Admins assign them per collection; a collection without assignments
// offers the seeded system templates.
// ---------------------------------------------------------------------------

export async function getTemplateById(id: string): Promise<ContentTemplate | undefined> {
  return db.query.contentTemplates.findFirst({ where: eq(contentTemplates.id, id) });
}

export async function getTemplateBySystemKey(key: SystemTemplateKey): Promise<ContentTemplate | undefined> {
  return db.query.contentTemplates.findFirst({ where: eq(contentTemplates.systemKey, key) });
}

export type TemplateListItem = ContentTemplate & { assignmentCount: number };

/** All templates (system first, then by name) with their assignment count. */
export async function listTemplates(): Promise<TemplateListItem[]> {
  const rows = await db
    .select({
      template: contentTemplates,
      assignmentCount: sql<number>`(select count(*)::int from ${knowledgeAreaTemplates} where ${knowledgeAreaTemplates}."template_id" = ${contentTemplates}."id")`,
    })
    .from(contentTemplates)
    .orderBy(desc(contentTemplates.isSystem), asc(contentTemplates.name));
  return rows.map((r) => ({ ...r.template, assignmentCount: r.assignmentCount }));
}

export async function listTemplateVersions(templateId: string): Promise<ContentTemplateVersion[]> {
  return db.query.contentTemplateVersions.findMany({
    where: eq(contentTemplateVersions.templateId, templateId),
    orderBy: [desc(contentTemplateVersions.version)],
  });
}

export type SaveTemplateInput = {
  id?: string;
  name: string;
  description?: string | null;
  icon?: string;
  definition: StructureDefinition;
};

/** Creates or updates a template and writes a version snapshot. System templates are seed-managed and rejected. */
export async function saveTemplate(input: SaveTemplateInput, actorId: string, changeNote?: string | null): Promise<ContentTemplate | { error: "system" | "notFound" }> {
  const result = await db.transaction(async (tx) => {
    let row: ContentTemplate;
    if (input.id) {
      const existing = await tx.query.contentTemplates.findFirst({ where: eq(contentTemplates.id, input.id) });
      if (!existing) return { error: "notFound" as const };
      if (existing.isSystem) return { error: "system" as const };
      [row] = await tx
        .update(contentTemplates)
        .set({
          name: input.name,
          description: input.description ?? null,
          icon: input.icon ?? existing.icon,
          definition: input.definition,
          version: existing.version + 1,
          updatedBy: actorId,
        })
        .where(eq(contentTemplates.id, existing.id))
        .returning();
    } else {
      [row] = await tx
        .insert(contentTemplates)
        .values({ name: input.name, description: input.description ?? null, icon: input.icon ?? "file-text", definition: input.definition, version: 1, createdBy: actorId, updatedBy: actorId })
        .returning();
    }
    await tx.insert(contentTemplateVersions).values({
      templateId: row.id,
      version: row.version,
      definition: input.definition,
      changeNote: changeNote?.trim() || null,
      createdBy: actorId,
    });
    return row;
  });
  if ("error" in result) return result;
  await db.insert(auditLog).values({
    actorId,
    action: result.version === 1 ? "content_template.created" : "content_template.updated",
    targetType: "content_template",
    targetId: result.id,
    details: { name: result.name, version: result.version },
  });
  return result;
}

/** Deletes a custom template; FK cascade removes assignments and version rows. Entries keep their snapshots. */
export async function deleteTemplate(id: string, actorId: string): Promise<{ ok: boolean; reason?: "system" | "notFound" }> {
  const existing = await getTemplateById(id);
  if (!existing) return { ok: false, reason: "notFound" };
  if (existing.isSystem) return { ok: false, reason: "system" };
  await db.delete(contentTemplates).where(eq(contentTemplates.id, id));
  await db.insert(auditLog).values({ actorId, action: "content_template.deleted", targetType: "content_template", targetId: id, details: { name: existing.name } });
  return { ok: true };
}

/** Assigned template ids for a collection, in display order. */
export async function listAreaTemplateIds(areaId: string): Promise<string[]> {
  const rows = await db.query.knowledgeAreaTemplates.findMany({
    where: eq(knowledgeAreaTemplates.areaId, areaId),
    orderBy: [asc(knowledgeAreaTemplates.sortOrder)],
  });
  return rows.map((r) => r.templateId);
}

/** Replaces a collection's template assignments (array order = display order). Empty = system templates. */
export async function setAreaTemplates(areaId: string, templateIds: string[], actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(knowledgeAreaTemplates).where(eq(knowledgeAreaTemplates.areaId, areaId));
    if (templateIds.length > 0) {
      await tx.insert(knowledgeAreaTemplates).values(templateIds.map((templateId, i) => ({ areaId, templateId, sortOrder: i })));
    }
  });
  await db.insert(auditLog).values({ actorId, action: "knowledge_area.templates_updated", targetType: "knowledge_area", targetId: areaId, details: { templateIds } });
}

const SYSTEM_ORDER = Object.values(SYSTEM_TEMPLATE_IDS);

function systemSort(a: ContentTemplate, b: ContentTemplate): number {
  return SYSTEM_ORDER.indexOf(a.id) - SYSTEM_ORDER.indexOf(b.id);
}

/** Templates a member can pick from in this collection: assigned ones, or the system templates when none are assigned. */
export async function listAvailableTemplates(areaId: string): Promise<ContentTemplate[]> {
  const assignments = await db.query.knowledgeAreaTemplates.findMany({
    where: eq(knowledgeAreaTemplates.areaId, areaId),
    orderBy: [asc(knowledgeAreaTemplates.sortOrder)],
  });
  if (assignments.length === 0) {
    const system = await db.query.contentTemplates.findMany({ where: eq(contentTemplates.isSystem, true) });
    return system.sort(systemSort);
  }
  const ids = assignments.map((a) => a.templateId);
  const templates = await db.query.contentTemplates.findMany({ where: inArray(contentTemplates.id, ids) });
  const byId = new Map(templates.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is ContentTemplate => Boolean(t));
}

export async function isTemplateAvailableForArea(areaId: string, templateId: string): Promise<boolean> {
  const available = await listAvailableTemplates(areaId);
  return available.some((t) => t.id === templateId);
}

/** areaId → number of assigned templates (0 = system defaults), for admin list badges. */
export async function listAssignmentsByArea(): Promise<Map<string, number>> {
  const rows = await db
    .select({ areaId: knowledgeAreaTemplates.areaId, count: sql<number>`count(*)::int` })
    .from(knowledgeAreaTemplates)
    .groupBy(knowledgeAreaTemplates.areaId);
  return new Map(rows.map((r) => [r.areaId, r.count]));
}

/** All assignments with template names, batched for the MCP collections context. */
export async function listAllAssignments(): Promise<Map<string, { id: string; name: string; version: number }[]>> {
  const rows = await db
    .select({ areaId: knowledgeAreaTemplates.areaId, sortOrder: knowledgeAreaTemplates.sortOrder, id: contentTemplates.id, name: contentTemplates.name, version: contentTemplates.version })
    .from(knowledgeAreaTemplates)
    .innerJoin(contentTemplates, eq(knowledgeAreaTemplates.templateId, contentTemplates.id))
    .orderBy(asc(knowledgeAreaTemplates.areaId), asc(knowledgeAreaTemplates.sortOrder));
  const map = new Map<string, { id: string; name: string; version: number }[]>();
  for (const r of rows) {
    const list = map.get(r.areaId) ?? [];
    list.push({ id: r.id, name: r.name, version: r.version });
    map.set(r.areaId, list);
  }
  return map;
}
