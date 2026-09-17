import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { agentMessages, agentThreads, aiAgents, users } from "@/server/db/schema";
import { loadCommunity } from "@/server/domain/communities";
import { env } from "@/server/env";
import { nextWeekStart, weekStart } from "@/lib/week";

/**
 * Weekly agent quota. Input and output tokens are counted separately and combined with a weight,
 * because output costs several times what input costs – a plain sum would let expensive turns
 * look cheap (see docs/ki-agenten.md 1.7).
 *
 *   weighted = promptTokens + completionTokens × outputWeight
 *
 * Members only ever see a percentage; the euro amounts stay in the admin view.
 * Runs in the worker – no next/* imports.
 */

export type UsageTotals = { promptTokens: number; completionTokens: number; weighted: number; cost: number };

export type BudgetStatus = UsageTotals & {
  /** 0 = no limit configured */
  budget: number;
  outputWeight: number;
  /** 0–100, capped; 0 when no limit is configured */
  percent: number;
  exceeded: boolean;
  resetsAt: Date;
};

const ZERO: UsageTotals = { promptTokens: 0, completionTokens: 0, weighted: 0, cost: 0 };

function weighted(promptTokens: number, completionTokens: number, outputWeight: number): number {
  return promptTokens + completionTokens * outputWeight;
}

/** Sum of an agent user's assistant messages since `since`. Usage lives in jsonb, hence the casts. */
async function sumUsage(userId: string, since: Date, outputWeight: number): Promise<UsageTotals> {
  const [row] = await db
    .select({
      promptTokens: sql<number>`coalesce(sum((${agentMessages.usage} ->> 'promptTokens')::bigint), 0)::bigint`,
      completionTokens: sql<number>`coalesce(sum((${agentMessages.usage} ->> 'completionTokens')::bigint), 0)::bigint`,
      cost: sql<number>`coalesce(sum((${agentMessages.usage} ->> 'cost')::numeric), 0)::float8`,
    })
    .from(agentMessages)
    .innerJoin(agentThreads, eq(agentThreads.id, agentMessages.threadId))
    .where(and(eq(agentThreads.userId, userId), gte(agentMessages.createdAt, since)));
  const promptTokens = Number(row?.promptTokens ?? 0);
  const completionTokens = Number(row?.completionTokens ?? 0);
  return { promptTokens, completionTokens, cost: Number(row?.cost ?? 0), weighted: weighted(promptTokens, completionTokens, outputWeight) };
}

/** The weekly quota is configured per community, so it is checked per community too. */
export async function getBudgetStatus(communityId: string, userId: string): Promise<BudgetStatus> {
  const settings = await loadCommunity(communityId);
  const now = new Date();
  // A vanished community has no quota to enforce – the caller fails on the missing community anyway.
  if (!settings) {
    return { ...ZERO, budget: 0, outputWeight: 1, percent: 0, exceeded: false, resetsAt: nextWeekStart(now, env.APP_TIMEZONE) };
  }
  const since = weekStart(now, env.APP_TIMEZONE);
  const totals = settings.agentWeeklyTokenBudget > 0 ? await sumUsage(userId, since, settings.agentOutputTokenWeight) : ZERO;
  const budget = settings.agentWeeklyTokenBudget;
  return {
    ...totals,
    budget,
    outputWeight: settings.agentOutputTokenWeight,
    percent: budget > 0 ? Math.min(100, Math.round((totals.weighted / budget) * 100)) : 0,
    exceeded: budget > 0 && totals.weighted >= budget,
    resetsAt: nextWeekStart(now, env.APP_TIMEZONE),
  };
}

/**
 * Weighs a running turn's own usage with the factor from `getBudgetStatus`, so the loop can stop
 * mid-turn without another query per step.
 */
export function weighUsage(promptTokens: number, completionTokens: number, outputWeight: number): number {
  return weighted(promptTokens, completionTokens, outputWeight);
}

export type MemberUsage = { userId: string; name: string; email: string } & UsageTotals;

/** Admin overview: this week's consumption per member, biggest first. */
export async function listWeeklyUsage(communityId: string): Promise<{ since: Date; budget: number; outputWeight: number; rows: MemberUsage[] }> {
  const settings = await loadCommunity(communityId);
  const since = weekStart(new Date(), env.APP_TIMEZONE);
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      promptTokens: sql<number>`coalesce(sum((${agentMessages.usage} ->> 'promptTokens')::bigint), 0)::bigint`,
      completionTokens: sql<number>`coalesce(sum((${agentMessages.usage} ->> 'completionTokens')::bigint), 0)::bigint`,
      cost: sql<number>`coalesce(sum((${agentMessages.usage} ->> 'cost')::numeric), 0)::float8`,
    })
    .from(agentMessages)
    .innerJoin(agentThreads, eq(agentThreads.id, agentMessages.threadId))
    .innerJoin(users, eq(users.id, agentThreads.userId))
    .innerJoin(aiAgents, eq(aiAgents.id, agentThreads.agentId))
    .where(and(gte(agentMessages.createdAt, since), eq(aiAgents.communityId, communityId)))
    .groupBy(users.id, users.name, users.email);

  const outputWeight = settings?.agentOutputTokenWeight ?? 1;
  return {
    since,
    budget: settings?.agentWeeklyTokenBudget ?? 0,
    outputWeight,
    rows: rows
      .map((r) => {
        const promptTokens = Number(r.promptTokens);
        const completionTokens = Number(r.completionTokens);
        return { userId: r.userId, name: r.name, email: r.email, promptTokens, completionTokens, cost: Number(r.cost), weighted: weighted(promptTokens, completionTokens, outputWeight) };
      })
      .sort((a, b) => b.weighted - a.weighted),
  };
}
