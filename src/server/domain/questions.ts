import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { questionDismissals, questionResponses, questions, users, workflows, type Question, type QuestionAudience, type QuestionField } from "@/server/db/schema";
import { emitDomainEvent } from "@/server/events/bus";
import { publishBroadcast, publishToUser, publishToUsers } from "@/server/realtime/publish";
import type { QuestionDto } from "@/lib/realtime-events";

export function toQuestionDto(q: Question, workflowName: string | null = null): QuestionDto {
  return {
    id: q.id,
    questionKey: q.questionKey,
    title: q.title,
    description: q.description,
    fields: q.fields,
    allowDismiss: q.allowDismiss,
    expiresAt: q.expiresAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
    workflowName,
  };
}

export type CreateQuestionInput = {
  questionKey: string;
  title: string;
  description?: string | null;
  fields: QuestionField[];
  audience: QuestionAudience;
  recipientIds: string[]; // resolved; [] with audience.type=all means everyone
  allowDismiss: boolean;
  expiresAt?: Date | null;
  workflowId?: string | null;
  runId?: string | null;
  stepId?: string | null;
  workflowName?: string | null;
};

/** Creates a question and pushes it live to the recipients (broadcast for "all"). */
export async function createQuestion(input: CreateQuestionInput): Promise<Question> {
  const [q] = await db
    .insert(questions)
    .values({
      questionKey: input.questionKey,
      title: input.title,
      description: input.description ?? null,
      fields: input.fields,
      audience: input.audience,
      recipientIds: input.audience.type === "all" ? [] : input.recipientIds,
      allowDismiss: input.allowDismiss,
      expiresAt: input.expiresAt ?? null,
      workflowId: input.workflowId ?? null,
      runId: input.runId ?? null,
      stepId: input.stepId ?? null,
    })
    .returning();
  const dto = toQuestionDto(q, input.workflowName ?? null);
  if (input.audience.type === "all") await publishBroadcast("question.created", { question: dto });
  else await publishToUsers(input.recipientIds, "question.created", { question: dto });
  return q;
}

function isOpen(q: Question): boolean {
  return !q.closedAt && (!q.expiresAt || q.expiresAt > new Date());
}

/** Open questions for a user: targeted at them, not answered, not dismissed. */
export async function listOpenQuestionsForUser(userId: string): Promise<QuestionDto[]> {
  const now = new Date();
  const rows = await db.query.questions.findMany({
    where: and(isNull(questions.closedAt), or(isNull(questions.expiresAt), gt(questions.expiresAt, now))),
    orderBy: [desc(questions.createdAt)],
    limit: 50,
  });
  const mine = rows.filter((q) => q.audience.type === "all" || q.recipientIds.includes(userId));
  if (!mine.length) return [];
  const ids = mine.map((q) => q.id);
  const [answered, dismissed] = await Promise.all([
    db.select({ id: questionResponses.questionId }).from(questionResponses).where(and(eq(questionResponses.userId, userId), inArray(questionResponses.questionId, ids))),
    db.select({ id: questionDismissals.questionId }).from(questionDismissals).where(and(eq(questionDismissals.userId, userId), inArray(questionDismissals.questionId, ids))),
  ]);
  const skip = new Set([...answered.map((r) => r.id), ...dismissed.map((r) => r.id)]);
  const open = mine.filter((q) => !skip.has(q.id));
  const wfIds = [...new Set(open.map((q) => q.workflowId).filter((x): x is string => !!x))];
  const wfs = wfIds.length ? await db.query.workflows.findMany({ where: inArray(workflows.id, wfIds), columns: { id: true, name: true } }) : [];
  const names = new Map(wfs.map((w) => [w.id, w.name]));
  return open.map((q) => toQuestionDto(q, q.workflowId ? (names.get(q.workflowId) ?? null) : null));
}

export function validateAnswers(fields: QuestionField[], answers: Record<string, unknown>): { ok: true; answers: Record<string, unknown> } | { ok: false; error: string } {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = answers[f.key];
    const missing = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (f.type !== "cta" && f.required && missing) return { ok: false, error: `field "${f.key}" is required` };
    if (missing) continue;
    switch (f.type) {
      case "single_choice":
        if (typeof v !== "string" || !f.options.includes(v)) return { ok: false, error: `invalid option for "${f.key}"` };
        out[f.key] = v;
        break;
      case "multi_choice":
        if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !f.options.includes(x))) return { ok: false, error: `invalid options for "${f.key}"` };
        out[f.key] = v;
        break;
      case "text":
        out[f.key] = String(v).slice(0, 4000);
        break;
      case "rating": {
        const n = Number(v);
        const max = f.max ?? 5;
        if (!Number.isInteger(n) || n < 1 || n > max) return { ok: false, error: `rating for "${f.key}" must be 1–${max}` };
        out[f.key] = n;
        break;
      }
      case "yes_no":
        if (typeof v !== "boolean") return { ok: false, error: `"${f.key}" must be yes/no` };
        out[f.key] = v;
        break;
      case "cta":
        out[f.key] = true;
        break;
    }
  }
  return { ok: true, answers: out };
}

/** Distribution of choice/rating/yes_no answers for a question. */
export async function questionStats(questionId: string): Promise<{ responses: number; distribution: Record<string, Record<string, number>> }> {
  const q = await db.query.questions.findFirst({ where: eq(questions.id, questionId) });
  if (!q) return { responses: 0, distribution: {} };
  const rows = await db.query.questionResponses.findMany({ where: eq(questionResponses.questionId, questionId) });
  const distribution: Record<string, Record<string, number>> = {};
  for (const f of q.fields) {
    if (!["single_choice", "multi_choice", "rating", "yes_no", "cta"].includes(f.type)) continue;
    const d: Record<string, number> = {};
    for (const r of rows) {
      const v = r.answers[f.key];
      if (v === undefined || v === null) continue;
      const keys = Array.isArray(v) ? v.map(String) : [String(v)];
      for (const k of keys) d[k] = (d[k] ?? 0) + 1;
    }
    distribution[f.key] = d;
  }
  return { responses: rows.length, distribution };
}

export async function answerQuestion(userId: string, questionId: string, rawAnswers: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const q = await db.query.questions.findFirst({ where: eq(questions.id, questionId) });
  if (!q || !isOpen(q)) return { ok: false, error: "question is closed" };
  if (q.audience.type !== "all" && !q.recipientIds.includes(userId)) return { ok: false, error: "not addressed to you" };
  const v = validateAnswers(q.fields, rawAnswers);
  if (!v.ok) return v;
  await db
    .insert(questionResponses)
    .values({ questionId, userId, answers: v.answers })
    .onConflictDoUpdate({ target: [questionResponses.questionId, questionResponses.userId], set: { answers: v.answers, updatedAt: new Date() } });
  const [user, stats] = await Promise.all([db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true, name: true } }), questionStats(questionId)]);
  emitDomainEvent("question.answered", {
    question: { id: q.id, key: q.questionKey, title: q.title, workflowId: q.workflowId, fields: q.fields },
    response: { answers: v.answers, answeredAt: new Date().toISOString() },
    user: { id: userId, name: user?.name ?? "" },
    stats,
    actorId: userId,
    origin: { kind: "user" },
  });
  await publishToUser(userId, "question.closed", { questionId });
  return { ok: true };
}

export async function dismissQuestion(userId: string, questionId: string): Promise<void> {
  const q = await db.query.questions.findFirst({ where: eq(questions.id, questionId) });
  if (!q || !q.allowDismiss) return;
  await db.insert(questionDismissals).values({ questionId, userId }).onConflictDoNothing();
}

export async function closeQuestion(questionId: string): Promise<void> {
  const [q] = await db.update(questions).set({ closedAt: new Date() }).where(and(eq(questions.id, questionId), isNull(questions.closedAt))).returning();
  if (!q) return;
  if (q.audience.type === "all") await publishBroadcast("question.closed", { questionId });
  else await publishToUsers(q.recipientIds, "question.closed", { questionId });
}

export type QuestionListItem = Question & { responseCount: number; workflowName: string | null; isOpen: boolean };

export async function listQuestions(opts: { limit?: number; questionKey?: string } = {}): Promise<QuestionListItem[]> {
  const rows = await db.execute<{ id: string; response_count: number; workflow_name: string | null }>(sql`
    select q.id, (select count(*)::int from question_responses r where r.question_id = q.id) as response_count,
      (select w.name from workflows w where w.id = q.workflow_id) as workflow_name
    from questions q ${opts.questionKey ? sql`where q.question_key = ${opts.questionKey}` : sql``}
    order by q.created_at desc limit ${opts.limit ?? 100}
  `);
  if (!rows.rows.length) return [];
  const qs = await db.query.questions.findMany({ where: inArray(questions.id, rows.rows.map((r) => r.id)) });
  const byId = new Map(qs.map((q) => [q.id, q]));
  return rows.rows.map((r) => ({ ...byId.get(r.id)!, responseCount: r.response_count, workflowName: r.workflow_name, isOpen: isOpen(byId.get(r.id)!) })).filter((x) => x.id);
}

export async function getQuestionWithResponses(questionId: string) {
  const q = await db.query.questions.findFirst({ where: eq(questions.id, questionId) });
  if (!q) return undefined;
  const responses = await db
    .select({ id: questionResponses.id, answers: questionResponses.answers, createdAt: questionResponses.createdAt, user: { id: users.id, name: users.name, avatarMediaId: users.avatarMediaId } })
    .from(questionResponses)
    .innerJoin(users, eq(users.id, questionResponses.userId))
    .where(eq(questionResponses.questionId, questionId))
    .orderBy(desc(questionResponses.createdAt));
  const stats = await questionStats(questionId);
  return { question: q, responses, stats, open: isOpen(q) };
}

/** Distinct question keys known from created questions (for trigger pickers / MCP). */
export async function listQuestionKeys(): Promise<{ key: string; title: string; count: number }[]> {
  const rows = await db.execute<{ key: string; title: string; count: number }>(sql`
    select question_key as key, max(title) as title, count(*)::int as count from questions group by question_key order by max(created_at) desc limit 200
  `);
  return rows.rows;
}
