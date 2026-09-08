import { emitDomainEvent, type EventOrigin, type LlmErrorPayload } from "@/server/events/bus";
import { LlmError } from "./client";
import { getRedis } from "@/server/redis";
import { logger } from "@/server/logger";
import type { LlmProvider } from "@/server/db/schema";

/**
 * Reports a failed LLM call as a domain event so an admin can build an alerting workflow
 * (trigger `llm.error`).
 *
 * A provider outage does not fail once, it fails on every call – summarising a burst is the whole
 * point. Without the cooldown a ten-minute outage would start dozens of workflow runs, each of
 * which may call an LLM itself.
 */
const COOLDOWN_SECONDS = 10 * 60;

const cooldownKey = (providerId: string, model: string) => `aiup-llm-error-${providerId}-${model}`;

export type LlmErrorContext = {
  provider: Pick<LlmProvider, "id" | "name" | "kind">;
  model: string;
  source: LlmErrorPayload["source"];
  sourceId?: string | null;
  href?: string | null;
  actorId?: string | null;
  origin?: EventOrigin;
};

/** Best effort in every direction: reporting a failure must never turn into a second one. */
export async function reportLlmError(err: unknown, ctx: LlmErrorContext): Promise<void> {
  try {
    const first = await getRedis().set(cooldownKey(ctx.provider.id, ctx.model), "1", "EX", COOLDOWN_SECONDS, "NX");
    // "NX" returns null when the key was already there – the outage is already reported.
    if (first === null) return;
  } catch (redisErr) {
    // No Redis, no throttle. Reporting once is still better than staying silent.
    logger.warn({ err: redisErr }, "llm error cooldown unavailable");
  }
  try {
    emitDomainEvent("llm.error", {
      provider: { id: ctx.provider.id, name: ctx.provider.name, kind: ctx.provider.kind },
      model: ctx.model,
      status: err instanceof LlmError ? (err.status ?? null) : null,
      message: (err as Error)?.message?.slice(0, 500) ?? "unknown error",
      source: ctx.source,
      sourceId: ctx.sourceId ?? null,
      href: ctx.href ?? null,
      actorId: ctx.actorId ?? null,
      origin: ctx.origin ?? { kind: "system" },
    });
  } catch (emitErr) {
    logger.warn({ err: emitErr }, "could not report llm error");
  }
}
