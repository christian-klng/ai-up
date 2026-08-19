"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/server/auth/session";
import { API_SCOPES, createApiKey, revokeApiKey, type ApiScope } from "@/server/domain/api-keys";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
  expiresInDays: z.coerce.number().int().min(0).max(3650).default(0),
});

export async function createApiKeyAction(input: { name: string; scopes: string[]; expiresInDays: number }): Promise<{ ok: true; plaintext: string; id: string } | { ok: false; error: string }> {
  const admin = await assertAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  const { key, plaintext } = await createApiKey(admin.id, parsed.data.name, parsed.data.scopes as ApiScope[], parsed.data.expiresInDays > 0 ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000) : null);
  revalidatePath("/admin/api-keys");
  return { ok: true, plaintext, id: key.id };
}

export async function revokeApiKeyAction(id: string): Promise<void> {
  const admin = await assertAdmin();
  await revokeApiKey(z.string().uuid().parse(id), admin.id);
  revalidatePath("/admin/api-keys");
}
