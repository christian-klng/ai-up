"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin, assertUser } from "@/server/auth/session";
import { answerQuestion, closeQuestion, dismissQuestion, listOpenQuestionsForUser } from "@/server/domain/questions";
import type { QuestionDto } from "@/lib/realtime-events";

export async function answerQuestionAction(questionId: string, answers: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await assertUser();
  const id = z.string().uuid().parse(questionId);
  return answerQuestion(me.id, id, z.record(z.string(), z.unknown()).parse(answers ?? {}));
}

export async function dismissQuestionAction(questionId: string): Promise<void> {
  const me = await assertUser();
  await dismissQuestion(me.id, z.string().uuid().parse(questionId));
}

export async function refreshOpenQuestionsAction(): Promise<QuestionDto[]> {
  const me = await assertUser();
  return listOpenQuestionsForUser(me.id);
}

export async function closeQuestionAction(questionId: string): Promise<void> {
  await assertAdmin();
  await closeQuestion(z.string().uuid().parse(questionId));
  revalidatePath("/admin/questions");
}
