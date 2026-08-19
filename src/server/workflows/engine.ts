import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users, workflowRunSteps, workflowRuns, workflows, type Workflow, type WorkflowRun } from "@/server/db/schema";
import { loadAppSettings } from "@/server/domain/settings";
import { createNotifications, localized } from "@/server/domain/notifications";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { publishBroadcast, publishToUsers } from "@/server/realtime/publish";
import { getAction, loadRegistry } from "./registry";
import { evaluateCondition, renderConfig } from "./templates";
import type { ActionRunContext, TemplateContext } from "./types";

const MAX_DEPTH = 3;

/**
 * Creates a queued run row for a workflow (does not execute). Returns undefined when the depth guard trips.
 */
export async function createRun(
  workflow: Workflow,
  triggerEvent: Record<string, unknown>,
  opts: { triggeredBy?: string | null; parentRunId?: string | null; depth?: number } = {},
): Promise<WorkflowRun | undefined> {
  const depth = opts.depth ?? 0;
  if (depth > MAX_DEPTH) {
    logger.warn({ workflowId: workflow.id, depth }, "workflow run depth guard – not creating run");
    return undefined;
  }
  const [run] = await db
    .insert(workflowRuns)
    .values({
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      workflowName: workflow.name,
      status: "queued",
      triggerType: workflow.trigger.type,
      triggerEvent,
      triggeredBy: opts.triggeredBy ?? null,
      parentRunId: opts.parentRunId ?? null,
      depth,
    })
    .returning();
  return run;
}

async function publishRunEvent(workflow: Workflow, event: Parameters<typeof publishBroadcast>[0], payload: Parameters<typeof publishBroadcast>[1]) {
  if (workflow.toastAudience === "admins") {
    const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
    await publishToUsers(
      admins.map((a) => a.id),
      event,
      payload,
    );
  } else {
    await publishBroadcast(event, payload);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Executes a queued run: renders each step's templates, validates config, runs the action,
 * records inputs/outputs per step, publishes realtime events, notifies admins on failure.
 */
export async function executeRun(runId: string): Promise<WorkflowRun | undefined> {
  await loadRegistry();
  const run = await db.query.workflowRuns.findFirst({ where: eq(workflowRuns.id, runId) });
  if (!run) return undefined;
  if (run.status !== "queued") {
    logger.warn({ runId, status: run.status }, "run not queued – skipping");
    return run;
  }
  const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, run.workflowId) });
  if (!workflow) {
    await db.update(workflowRuns).set({ status: "failed", error: "workflow deleted", finishedAt: new Date(), durationMs: 0 }).where(eq(workflowRuns.id, runId));
    return undefined;
  }
  const settings = await loadAppSettings();
  const startedAt = new Date();
  await db.update(workflowRuns).set({ status: "running", startedAt }).where(eq(workflowRuns.id, runId));
  await db.update(workflows).set({ lastRunAt: startedAt }).where(eq(workflows.id, workflow.id));
  await publishRunEvent(workflow, "workflow.run.started", { runId, workflowId: workflow.id, workflowName: workflow.name, triggerType: run.triggerType, startedAt: startedAt.toISOString() });

  const template: TemplateContext = {
    trigger: run.triggerEvent,
    steps: {},
    app: { name: settings.name, purpose: settings.purpose ?? "", url: env.APP_URL },
    run: { id: run.id, workflowId: workflow.id, workflowName: workflow.name, triggeredBy: run.triggeredBy },
    now: new Date().toISOString(),
  };

  let failure: string | null = null;
  const stepsDef = workflow.steps; // snapshot: runs use the definition current at execution time (version recorded on the run)

  for (let i = 0; i < stepsDef.length; i++) {
    const step = stepsDef[i];
    const action = getAction(step.action);
    const [stepRow] = await db
      .insert(workflowRunSteps)
      .values({ runId, index: i, stepId: step.id, stepName: step.name ?? null, actionType: step.action, status: "queued" })
      .returning();
    const stepStart = Date.now();
    const finishStep = (patch: Partial<typeof workflowRunSteps.$inferInsert>) =>
      db.update(workflowRunSteps).set({ ...patch, finishedAt: new Date(), durationMs: Date.now() - stepStart }).where(eq(workflowRunSteps.id, stepRow.id));

    if (!action) {
      await finishStep({ status: "failed", error: `unknown action "${step.action}"` });
      failure = `step "${step.id}": unknown action "${step.action}"`;
      break;
    }
    try {
      // condition
      if (!(await evaluateCondition(step.condition, template))) {
        await finishStep({ status: "succeeded", skipped: true, output: {} });
        template.steps[step.id] = { output: {} };
        continue;
      }
      await db.update(workflowRunSteps).set({ status: "running", startedAt: new Date() }).where(eq(workflowRunSteps.id, stepRow.id));
      const rendered = await renderConfig(step.config, action.templateKeys, template);
      const parsed = action.configSchema.safeParse(rendered);
      if (!parsed.success) {
        const msg = parsed.error.issues.map((x) => `${x.path.join(".") || "config"}: ${x.message}`).join("; ");
        throw new Error(`invalid config – ${msg}`);
      }
      const ctx: ActionRunContext = {
        runId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        stepId: step.id,
        triggeredBy: run.triggeredBy,
        depth: run.depth,
        template,
        log: (message, data) => logger.info({ runId, stepId: step.id, ...data }, message),
      };
      const result = await withTimeout(action.run(parsed.data as Record<string, unknown>, ctx), action.timeoutMs, `step "${step.id}"`);
      template.steps[step.id] = { output: result.output };
      await finishStep({ status: "succeeded", input: safeInput(rendered), output: safeJson(result.output), usage: result.usage ?? {} });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ runId, stepId: step.id, err: message }, "workflow step failed");
      await finishStep({ status: "failed", error: message.slice(0, 4000) });
      template.steps[step.id] = { output: { error: message } };
      if (step.onError === "continue") continue;
      failure = `step "${step.id}": ${message}`;
      break;
    }
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const status = failure ? "failed" : "succeeded";
  const [final] = await db
    .update(workflowRuns)
    .set({ status, error: failure, finishedAt, durationMs, context: safeJson({ steps: template.steps }) })
    .where(eq(workflowRuns.id, runId))
    .returning();
  await publishRunEvent(workflow, "workflow.run.finished", { runId, workflowId: workflow.id, workflowName: workflow.name, status, durationMs, error: failure, finishedAt: finishedAt.toISOString() });

  if (failure) {
    try {
      const admins = await db.select({ id: users.id, locale: users.locale }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
      await createNotifications(
        admins.map((a) => ({
          userId: a.id,
          type: "workflow.failed",
          title: localized(a.locale, { de: `Workflow „${workflow.name}“ fehlgeschlagen`, en: `Workflow “${workflow.name}” failed` }),
          body: failure.slice(0, 300),
          data: { href: `/admin/workflows/${workflow.id}/runs/${runId}`, workflowId: workflow.id, runId },
        })),
      );
    } catch (err) {
      logger.error({ err }, "failed to notify admins about workflow failure");
    }
  }
  return final;
}

/** Keeps stored JSON reasonably small (long texts are truncated for the run log, not for the live template context). */
function safeJson(obj: Record<string, unknown>): Record<string, unknown> {
  const LIMIT = 200_000;
  const s = JSON.stringify(obj);
  if (s.length <= LIMIT) return obj;
  const truncate = (v: unknown): unknown => {
    if (typeof v === "string") return v.length > 20_000 ? `${v.slice(0, 20_000)}… [truncated ${v.length - 20_000} chars]` : v;
    if (Array.isArray(v)) return v.slice(0, 200).map(truncate);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, truncate(x)]));
    return v;
  };
  return truncate(obj) as Record<string, unknown>;
}

function safeInput(obj: Record<string, unknown>): Record<string, unknown> {
  return safeJson(obj);
}
