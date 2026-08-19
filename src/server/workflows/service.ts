import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  auditLog,
  workflowRunSteps,
  workflowRuns,
  workflowVersions,
  workflows,
  type RunStatus,
  type Workflow,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowRunStep,
} from "@/server/db/schema";
import { validateDefinition, type ValidationResult } from "./definitions";
import { syncSchedules } from "./queue";

// ---------------------------------------------------------------------------
// Workflows CRUD (with versions)
// ---------------------------------------------------------------------------

export type WorkflowListItem = Workflow & { runCount: number; successCount: number; lastRunStatus: RunStatus | null };

export async function listWorkflows(opts: { onlyActive?: boolean } = {}): Promise<WorkflowListItem[]> {
  const rows = await db
    .select({
      wf: workflows,
      runCount: sql<number>`(select count(*)::int from ${workflowRuns} r where r.workflow_id = ${workflows}."id")`,
      successCount: sql<number>`(select count(*)::int from ${workflowRuns} r where r.workflow_id = ${workflows}."id" and r.status = 'succeeded')`,
      lastRunStatus: sql<RunStatus | null>`(select r.status from ${workflowRuns} r where r.workflow_id = ${workflows}."id" order by r.created_at desc limit 1)`,
    })
    .from(workflows)
    .where(opts.onlyActive ? eq(workflows.status, "active") : undefined)
    .orderBy(asc(workflows.name));
  return rows.map((r) => ({ ...r.wf, runCount: r.runCount, successCount: r.successCount, lastRunStatus: r.lastRunStatus }));
}

export async function getWorkflow(id: string): Promise<Workflow | undefined> {
  return db.query.workflows.findFirst({ where: eq(workflows.id, id) });
}

export function toDefinition(w: Workflow): WorkflowDefinition {
  return { name: w.name, description: w.description, trigger: w.trigger, steps: w.steps };
}

export type SaveResult = { ok: true; workflow: Workflow; warnings: { path: string; message: string }[] } | { ok: false; issues: { path: string; message: string }[] };

export async function createWorkflow(input: unknown, actorId: string | null, source: "ui" | "mcp" | "system" = "ui", opts: { status?: Workflow["status"]; changeNote?: string } = {}): Promise<SaveResult> {
  const v: ValidationResult = validateDefinition(input);
  if (!v.ok) return { ok: false, issues: v.issues };
  const d = v.definition;
  const workflow = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(workflows)
      .values({ name: d.name, description: d.description ?? null, trigger: d.trigger, steps: d.steps, status: opts.status ?? "draft", version: 1, createdBy: actorId, updatedBy: actorId })
      .returning();
    await tx.insert(workflowVersions).values({ workflowId: row.id, version: 1, definition: d, source, changeNote: opts.changeNote ?? null, changedBy: actorId });
    await tx.insert(auditLog).values({ actorId, action: "workflow.created", targetType: "workflow", targetId: row.id, details: { name: row.name, source } });
    return row;
  });
  await syncSchedules().catch(() => {});
  return { ok: true, workflow, warnings: v.warnings };
}

export async function updateWorkflow(id: string, input: unknown, actorId: string | null, source: "ui" | "mcp" | "system" = "ui", opts: { changeNote?: string } = {}): Promise<SaveResult | { ok: false; issues: { path: string; message: string }[]; notFound: true }> {
  const existing = await getWorkflow(id);
  if (!existing) return { ok: false, issues: [{ path: "id", message: "workflow not found" }], notFound: true };
  const v = validateDefinition(input);
  if (!v.ok) return { ok: false, issues: v.issues };
  const d = v.definition;
  const nextVersion = existing.version + 1;
  const workflow = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(workflows)
      .set({ name: d.name, description: d.description ?? null, trigger: d.trigger, steps: d.steps, version: nextVersion, updatedBy: actorId })
      .where(eq(workflows.id, id))
      .returning();
    await tx.insert(workflowVersions).values({ workflowId: id, version: nextVersion, definition: d, source, changeNote: opts.changeNote ?? null, changedBy: actorId });
    await tx.insert(auditLog).values({ actorId, action: "workflow.updated", targetType: "workflow", targetId: id, details: { name: row.name, version: nextVersion, source } });
    return row;
  });
  await syncSchedules().catch(() => {});
  return { ok: true, workflow, warnings: v.warnings };
}

export async function setWorkflowStatus(id: string, status: Workflow["status"], actorId: string | null): Promise<Workflow | undefined> {
  const [row] = await db.update(workflows).set({ status, updatedBy: actorId }).where(eq(workflows.id, id)).returning();
  if (row) {
    await db.insert(auditLog).values({ actorId, action: `workflow.${status}`, targetType: "workflow", targetId: id, details: { name: row.name } });
    await syncSchedules().catch(() => {});
  }
  return row;
}

export async function deleteWorkflow(id: string, actorId: string | null): Promise<void> {
  await db.delete(workflows).where(eq(workflows.id, id));
  await db.insert(auditLog).values({ actorId, action: "workflow.deleted", targetType: "workflow", targetId: id });
  await syncSchedules().catch(() => {});
}

export async function listWorkflowVersions(id: string) {
  return db.query.workflowVersions.findMany({ where: eq(workflowVersions.workflowId, id), orderBy: [desc(workflowVersions.version)] });
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export type RunListOptions = { workflowId?: string; status?: RunStatus; since?: Date; limit?: number; offset?: number };

export async function listRuns(opts: RunListOptions = {}): Promise<WorkflowRun[]> {
  const conds = [];
  if (opts.workflowId) conds.push(eq(workflowRuns.workflowId, opts.workflowId));
  if (opts.status) conds.push(eq(workflowRuns.status, opts.status));
  if (opts.since) conds.push(gte(workflowRuns.createdAt, opts.since));
  return db.query.workflowRuns.findMany({ where: conds.length ? and(...conds) : undefined, orderBy: [desc(workflowRuns.createdAt)], limit: opts.limit ?? 50, offset: opts.offset ?? 0 });
}

export async function getRunWithSteps(runId: string): Promise<(WorkflowRun & { steps: WorkflowRunStep[] }) | undefined> {
  const run = await db.query.workflowRuns.findFirst({ where: eq(workflowRuns.id, runId) });
  if (!run) return undefined;
  const steps = await db.query.workflowRunSteps.findMany({ where: eq(workflowRunSteps.runId, runId), orderBy: [asc(workflowRunSteps.index)] });
  return { ...run, steps };
}

export type WorkflowStats = {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  successRate: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  lastRunAt: Date | null;
  perDay: { day: string; succeeded: number; failed: number }[];
  tokens: { promptTokens: number; completionTokens: number; cost: number };
  topErrors: { error: string; count: number }[];
};

export async function workflowStats(workflowId: string | null, days = 14): Promise<WorkflowStats> {
  const since = new Date(Date.now() - days * 86_400_000);
  const wfCond = workflowId ? sql`and r.workflow_id = ${workflowId}` : sql``;
  const [agg] = await db.execute<{ total: number; succeeded: number; failed: number; running: number; avg_ms: number | null; p95_ms: number | null; last_run_at: Date | null }>(sql`
    select count(*)::int as total,
      count(*) filter (where r.status = 'succeeded')::int as succeeded,
      count(*) filter (where r.status = 'failed')::int as failed,
      count(*) filter (where r.status in ('queued','running'))::int as running,
      avg(r.duration_ms)::int as avg_ms,
      percentile_cont(0.95) within group (order by r.duration_ms)::int as p95_ms,
      max(r.created_at) as last_run_at
    from workflow_runs r where r.created_at >= ${since} ${wfCond}
  `).then((r) => r.rows);
  const perDayRows = await db.execute<{ day: string; succeeded: number; failed: number }>(sql`
    select to_char(date_trunc('day', r.created_at), 'YYYY-MM-DD') as day,
      count(*) filter (where r.status = 'succeeded')::int as succeeded,
      count(*) filter (where r.status = 'failed')::int as failed
    from workflow_runs r where r.created_at >= ${since} ${wfCond}
    group by 1 order by 1
  `).then((r) => r.rows);
  const [tok] = await db.execute<{ prompt_tokens: number; completion_tokens: number; cost: number }>(sql`
    select coalesce(sum((s.usage->>'promptTokens')::numeric),0)::int as prompt_tokens,
      coalesce(sum((s.usage->>'completionTokens')::numeric),0)::int as completion_tokens,
      coalesce(sum((s.usage->>'cost')::numeric),0)::float as cost
    from workflow_run_steps s join workflow_runs r on r.id = s.run_id
    where r.created_at >= ${since} ${wfCond}
  `).then((r) => r.rows);
  const topErrors = await db.execute<{ error: string; count: number }>(sql`
    select left(r.error, 160) as error, count(*)::int as count from workflow_runs r
    where r.created_at >= ${since} and r.status = 'failed' and r.error is not null ${wfCond}
    group by 1 order by 2 desc limit 5
  `).then((r) => r.rows);
  // Fill missing days
  const perDay: WorkflowStats["perDay"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const row = perDayRows.find((r) => r.day === day);
    perDay.push({ day, succeeded: row?.succeeded ?? 0, failed: row?.failed ?? 0 });
  }
  const total = agg?.total ?? 0;
  return {
    total,
    succeeded: agg?.succeeded ?? 0,
    failed: agg?.failed ?? 0,
    running: agg?.running ?? 0,
    successRate: total ? Math.round(((agg?.succeeded ?? 0) / total) * 100) : 0,
    avgDurationMs: agg?.avg_ms ?? null,
    p95DurationMs: agg?.p95_ms ?? null,
    lastRunAt: agg?.last_run_at ? new Date(agg.last_run_at) : null,
    perDay,
    tokens: { promptTokens: tok?.prompt_tokens ?? 0, completionTokens: tok?.completion_tokens ?? 0, cost: tok?.cost ?? 0 },
    topErrors,
  };
}
