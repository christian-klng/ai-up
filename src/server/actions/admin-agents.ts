"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/server/auth/session";
import { getAgentById, updateAgent } from "@/server/domain/agents";
import { updateAppSettings } from "@/server/domain/settings";
import { ensureBotUser } from "@/server/domain/bot";
import { generateRandomAvatar } from "@/server/media/avatars";
import { IMAGE_MIMES, processAndStoreImage } from "@/server/media/images";
import { logger } from "@/server/logger";
import type { AdminFormState } from "./admin-settings";

export type { AdminFormState };

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const agentSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  providerId: z.string(),
  model: z.string(),
  systemPrompt: z.string().trim().max(20_000),
  maxSteps: z.coerce.number().int().min(1).max(50),
  maxTokensPerTurn: z.coerce.number().int().min(1000).max(1_000_000),
  reasoningEffort: z.enum(["none", "low", "medium", "high"]),
});

export async function saveAgentAction(agentId: string, _prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await assertAdmin();
  const parsed = agentSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    providerId: formData.get("providerId") ?? "default",
    model: formData.get("model") ?? "default",
    systemPrompt: formData.get("systemPrompt") ?? "",
    maxSteps: formData.get("maxSteps"),
    maxTokensPerTurn: formData.get("maxTokensPerTurn"),
    reasoningEffort: formData.get("reasoningEffort") ?? "none",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  const agent = await getAgentById(agentId);
  if (!agent) return { status: "error", message: "not found" };
  const d = parsed.data;

  await updateAgent(
    agentId,
    {
      name: d.name,
      description: d.description ?? null,
      // "default" means: follow the admin's default provider / that provider's default model.
      providerId: d.providerId === "default" ? null : d.providerId,
      model: d.model === "default" ? null : d.model,
      systemPrompt: d.systemPrompt,
      maxSteps: d.maxSteps,
      maxTokensPerTurn: d.maxTokensPerTurn,
      reasoningEffort: d.reasoningEffort === "none" ? null : d.reasoningEffort,
    },
    admin.id,
  );
  // The bot user mirrors name and avatar of the system agent.
  if (agent.isSystem) await ensureBotUser().catch((err) => logger.warn({ err }, "bot sync after agent update failed"));
  revalidatePath("/", "layout");
  return { status: "saved" };
}

export async function uploadAgentAvatarAction(agentId: string, _prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await assertAdmin();
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "no file" };
  if (file.size > MAX_AVATAR_BYTES) return { status: "error", message: "too large" };
  if (!IMAGE_MIMES.has(file.type)) return { status: "error", message: "unsupported type" };
  try {
    const media = await processAndStoreImage({
      buffer: Buffer.from(await file.arrayBuffer()),
      originalName: file.name,
      purpose: "avatar",
      uploadedBy: admin.id,
      maxEdge: 512,
      square: true,
      thumbEdge: 96,
    });
    await setAgentAvatar(agentId, media.id, admin.id);
    return { status: "saved" };
  } catch (err) {
    logger.error({ err, agentId }, "agent avatar upload failed");
    return { status: "error", message: "upload failed" };
  }
}

/** Generates a fresh dicebear avatar (same generator as the member avatars). */
export async function rerollAgentAvatarAction(agentId: string): Promise<void> {
  const admin = await assertAdmin();
  const media = await generateRandomAvatar(agentId, crypto.randomUUID());
  await setAgentAvatar(agentId, media.id, admin.id);
}

async function setAgentAvatar(agentId: string, mediaId: string, actorId: string): Promise<void> {
  const agent = await getAgentById(agentId);
  if (!agent) return;
  await updateAgent(agentId, { avatarMediaId: mediaId }, actorId);
  if (agent.isSystem) await ensureBotUser().catch((err) => logger.warn({ err }, "bot sync after avatar change failed"));
  revalidatePath("/", "layout");
}

const quotaSchema = z.object({
  agentWeeklyTokenBudget: z.coerce.number().int().min(0).max(1_000_000_000),
  agentOutputTokenWeight: z.coerce.number().int().min(1).max(20),
});

/** Weekly quota per member. 0 turns the limit off; the numbers keep being recorded either way. */
export async function saveAgentQuotaAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await assertAdmin();
  const parsed = quotaSchema.safeParse({
    agentWeeklyTokenBudget: formData.get("agentWeeklyTokenBudget"),
    agentOutputTokenWeight: formData.get("agentOutputTokenWeight"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  await updateAppSettings(parsed.data);
  revalidatePath("/admin/agents");
  return { status: "saved" };
}
