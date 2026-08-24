"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/server/auth/session";
import { getAreaById } from "@/server/domain/knowledge";
import { deleteStructure, saveStructure } from "@/server/domain/structures";
import { validateStructure, type ValidationIssue } from "@/lib/structures/validate";

export type SaveStructureResult = { ok: true; version: number; warnings: ValidationIssue[] } | { ok: false; issues: ValidationIssue[] };

export async function saveStructureAction(input: { areaId: string; definition: unknown; changeNote?: string }): Promise<SaveStructureResult> {
  const admin = await assertAdmin();
  const area = await getAreaById(input.areaId);
  if (!area) return { ok: false, issues: [{ path: "", message: "collection not found" }] };
  const result = validateStructure(input.definition);
  if (!result.def) return { ok: false, issues: result.issues };
  const saved = await saveStructure(area.id, result.def, admin.id, input.changeNote);
  revalidatePath("/admin/knowledge");
  revalidatePath(`/knowledge/${area.slug}`, "layout");
  return { ok: true, version: saved.version, warnings: result.warnings };
}

export async function deleteStructureAction(areaId: string): Promise<{ ok: boolean }> {
  const admin = await assertAdmin();
  const area = await getAreaById(areaId);
  if (!area) return { ok: false };
  const ok = await deleteStructure(area.id, admin.id);
  revalidatePath("/admin/knowledge");
  revalidatePath(`/knowledge/${area.slug}`, "layout");
  return { ok };
}
