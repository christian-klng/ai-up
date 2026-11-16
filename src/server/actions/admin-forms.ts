"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/server/auth/session";
import { getCollectionForm, saveCollectionForm } from "@/server/domain/collection-forms";
import { formSettingsSchema, isFormFieldAllowed, type FormProblem, type FormSettings } from "@/lib/collection-forms";
import { isAnswerable } from "@/lib/structures/types";

/** One field of a template, as the dialog lists it. */
export type FormFieldOption = { key: string; label: string; type: string; required: boolean; allowed: boolean; answerable: boolean };

export type CollectionFormDialogData = {
  url: string | null;
  submissionCount: number;
  settings: FormSettings;
  templates: { id: string; name: string; icon: string; fields: FormFieldOption[] }[];
};

/** Everything the "external channel" dialog of a collection needs; loaded when it opens. */
export async function loadCollectionFormAction(areaId: string): Promise<CollectionFormDialogData | null> {
  const admin = await assertAdmin();
  const view = await getCollectionForm(admin.communityId, z.string().uuid().parse(areaId));
  if (!view) return null;
  return {
    url: view.url,
    submissionCount: view.form?.submissionCount ?? 0,
    settings: view.settings,
    templates: view.templates.map((tpl) => ({
      id: tpl.id,
      name: tpl.name,
      icon: tpl.icon,
      fields: tpl.definition.elements.map((el) => ({ key: el.key, label: el.label, type: el.type, required: Boolean(el.required), allowed: isFormFieldAllowed(el), answerable: isAnswerable(el) })),
    })),
  };
}

export type SaveCollectionFormResult = { ok: true; url: string; enabled: boolean } | { ok: false; code: "invalid" | "notFound" | "template" | FormProblem };

export async function saveCollectionFormAction(areaId: string, settings: FormSettings): Promise<SaveCollectionFormResult> {
  const admin = await assertAdmin();
  const id = z.string().uuid().safeParse(areaId);
  const parsed = formSettingsSchema.safeParse(settings);
  if (!id.success || !parsed.success) return { ok: false, code: "invalid" };
  const res = await saveCollectionForm(admin.communityId, id.data, parsed.data, admin.id);
  if (!res.ok) return { ok: false, code: res.reason };
  revalidatePath("/admin/knowledge");
  return { ok: true, url: res.url, enabled: res.form.enabled };
}
