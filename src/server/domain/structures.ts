import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, knowledgeStructureVersions, knowledgeStructures, type KnowledgeStructure, type KnowledgeStructureVersion } from "@/server/db/schema";
import type { StructureDefinition } from "@/lib/structures/types";

// ---------------------------------------------------------------------------
// Collection structures: one optional structure per collection (area),
// versioned like workflows (snapshot per save, changeNote).
// ---------------------------------------------------------------------------

export async function getStructureByAreaId(areaId: string): Promise<KnowledgeStructure | undefined> {
  return db.query.knowledgeStructures.findFirst({ where: eq(knowledgeStructures.areaId, areaId) });
}

/** Area ids that currently have a structure (for list badges). */
export async function listStructuredAreaIds(): Promise<string[]> {
  const rows = await db.select({ areaId: knowledgeStructures.areaId }).from(knowledgeStructures);
  return rows.map((r) => r.areaId);
}

export type StructureListItem = { areaId: string; structureId: string; version: number; updatedAt: Date };

/** All structures with their area and version (for the MCP collections context). */
export async function listStructures(): Promise<StructureListItem[]> {
  return db.select({ areaId: knowledgeStructures.areaId, structureId: knowledgeStructures.id, version: knowledgeStructures.version, updatedAt: knowledgeStructures.updatedAt }).from(knowledgeStructures);
}

/** Creates or updates the collection's structure and writes a version snapshot. */
export async function saveStructure(areaId: string, definition: StructureDefinition, actorId: string, changeNote?: string | null): Promise<KnowledgeStructure> {
  const result = await db.transaction(async (tx) => {
    const existing = await tx.query.knowledgeStructures.findFirst({ where: eq(knowledgeStructures.areaId, areaId) });
    let row: KnowledgeStructure;
    if (existing) {
      const nextVersion = existing.version + 1;
      [row] = await tx
        .update(knowledgeStructures)
        .set({ definition, version: nextVersion, updatedBy: actorId })
        .where(eq(knowledgeStructures.id, existing.id))
        .returning();
    } else {
      [row] = await tx.insert(knowledgeStructures).values({ areaId, definition, version: 1, updatedBy: actorId }).returning();
    }
    await tx.insert(knowledgeStructureVersions).values({
      structureId: row.id,
      version: row.version,
      definition,
      changeNote: changeNote?.trim() || null,
      createdBy: actorId,
    });
    return row;
  });
  await db.insert(auditLog).values({
    actorId,
    action: result.version === 1 ? "knowledge_structure.created" : "knowledge_structure.updated",
    targetType: "knowledge_structure",
    targetId: result.id,
    details: { areaId, version: result.version },
  });
  return result;
}

/** Removes the structure; the collection becomes free-form again. Entries keep their snapshots. */
export async function deleteStructure(areaId: string, actorId: string): Promise<boolean> {
  const existing = await getStructureByAreaId(areaId);
  if (!existing) return false;
  await db.delete(knowledgeStructures).where(eq(knowledgeStructures.id, existing.id));
  await db.insert(auditLog).values({ actorId, action: "knowledge_structure.deleted", targetType: "knowledge_structure", targetId: existing.id, details: { areaId } });
  return true;
}

export type StructureVersionListItem = KnowledgeStructureVersion & { createdByName: string | null };

export async function listStructureVersions(structureId: string): Promise<KnowledgeStructureVersion[]> {
  return db.query.knowledgeStructureVersions.findMany({
    where: eq(knowledgeStructureVersions.structureId, structureId),
    orderBy: [desc(knowledgeStructureVersions.version)],
  });
}
