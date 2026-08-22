"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/server/auth/session";
import { createSpace, deleteSpace, moveSpace, updateSpace } from "@/server/domain/meetings";
import { isAreaIconKey } from "@/components/knowledge/area-icon";

export type SpaceFormState = { status: "idle" } | { status: "saved"; slug: string } | { status: "error"; code: "nameRequired" | "purposeRequired" | "unexpected" };

const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  purpose: z.string().trim().min(5).max(2000),
  description: z.string().trim().max(2000).optional(),
  icon: z.string().refine(isAreaIconKey).catch("calendar"),
  recordingDefault: z.boolean(),
});

export async function saveSpaceAction(_prev: SpaceFormState, formData: FormData): Promise<SpaceFormState> {
  const admin = await assertAdmin();
  const parsed = schema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    purpose: formData.get("purpose"),
    description: formData.get("description") || undefined,
    icon: formData.get("icon") ?? "calendar",
    recordingDefault: formData.get("recordingDefault") === "on",
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { status: "error", code: field === "purpose" ? "purposeRequired" : field === "name" ? "nameRequired" : "unexpected" };
  }
  const { id, ...input } = parsed.data;
  const space = id ? await updateSpace(id, input, admin.id) : await createSpace(input, admin.id);
  if (!space) return { status: "error", code: "unexpected" };
  revalidatePath("/", "layout");
  return { status: "saved", slug: space.slug };
}

export async function deleteSpaceAction(id: string): Promise<{ ok: boolean; reason?: "notEmpty" }> {
  const admin = await assertAdmin();
  const ok = await deleteSpace(id, admin.id);
  if (ok) revalidatePath("/", "layout");
  return ok ? { ok } : { ok, reason: "notEmpty" };
}

export async function moveSpaceAction(id: string, direction: "up" | "down"): Promise<void> {
  await assertAdmin();
  await moveSpace(id, direction);
  revalidatePath("/", "layout");
}
