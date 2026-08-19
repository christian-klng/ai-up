"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/server/auth/session";
import { createArea, deleteArea, moveArea, updateArea } from "@/server/domain/knowledge";
import { isAreaIconKey } from "@/components/knowledge/area-icon";

export type AreaFormState = { status: "idle" } | { status: "saved"; slug: string } | { status: "error"; code: "nameRequired" | "purposeRequired" | "unexpected" };

const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  purpose: z.string().trim().min(5).max(2000),
  description: z.string().trim().max(2000).optional(),
  icon: z.string().refine(isAreaIconKey).catch("book"),
});

export async function saveAreaAction(_prev: AreaFormState, formData: FormData): Promise<AreaFormState> {
  const admin = await assertAdmin();
  const parsed = schema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    purpose: formData.get("purpose"),
    description: formData.get("description") || undefined,
    icon: formData.get("icon") ?? "book",
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { status: "error", code: field === "purpose" ? "purposeRequired" : field === "name" ? "nameRequired" : "unexpected" };
  }
  const { id, ...input } = parsed.data;
  const area = id ? await updateArea(id, input, admin.id) : await createArea(input, admin.id);
  if (!area) return { status: "error", code: "unexpected" };
  revalidatePath("/", "layout");
  return { status: "saved", slug: area.slug };
}

export async function deleteAreaAction(id: string): Promise<{ ok: boolean; reason?: "notEmpty" }> {
  const admin = await assertAdmin();
  const ok = await deleteArea(id, admin.id);
  if (ok) revalidatePath("/", "layout");
  return ok ? { ok } : { ok, reason: "notEmpty" };
}

export async function moveAreaAction(id: string, direction: "up" | "down"): Promise<void> {
  await assertAdmin();
  await moveArea(id, direction);
  revalidatePath("/", "layout");
}
