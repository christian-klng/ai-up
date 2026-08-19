"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/server/auth/session";
import type { Workflow } from "@/server/db/schema";
import { startRun } from "@/server/workflows/dispatch";
import { loadRegistry, getTrigger } from "@/server/workflows/registry";
import { createWorkflow, deleteWorkflow, getWorkflow, setWorkflowStatus, updateWorkflow, getRunWithSteps } from "@/server/workflows/service";
import { validateDefinition } from "@/server/workflows/definitions";
import { db } from "@/server/db/client";
import { workflows } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export type SaveWorkflowResult = { ok: true; id: string; warnings: { path: string; message: string }[] } | { ok: false; issues: { path: string; message: string }[] };

export async function saveWorkflowAction(input: { id?: string; definition: unknown; changeNote?: string }): Promise<SaveWorkflowResult> {
  const admin = await assertAdmin();
  await loadRegistry();
  const res = input.id ? await updateWorkflow(input.id, input.definition, admin.id, "ui", { changeNote: input.changeNote }) : await createWorkflow(input.definition, admin.id, "ui", { changeNote: input.changeNote });
  if (!res.ok) return { ok: false, issues: res.issues };
  revalidatePath("/admin/workflows");
  revalidatePath("/workflows");
  return { ok: true, id: res.workflow.id, warnings: res.warnings };
}

export async function validateWorkflowAction(definition: unknown) {
  await assertAdmin();
  await loadRegistry();
  return validateDefinition(definition);
}

export async function setWorkflowStatusAction(id: string, status: Workflow["status"]): Promise<void> {
  const admin = await assertAdmin();
  await setWorkflowStatus(id, status, admin.id);
  revalidatePath("/admin/workflows");
  revalidatePath("/workflows");
}

export async function setToastAudienceAction(id: string, audience: "all" | "admins"): Promise<void> {
  await assertAdmin();
  await db.update(workflows).set({ toastAudience: audience }).where(eq(workflows.id, id));
  revalidatePath("/admin/workflows");
}

export async function deleteWorkflowAction(id: string): Promise<void> {
  const admin = await assertAdmin();
  await deleteWorkflow(id, admin.id);
  revalidatePath("/admin/workflows");
  revalidatePath("/workflows");
}

/** Starts a run manually with a JSON payload (uses the trigger's sample payload if empty). */
export async function runWorkflowNowAction(id: string, payloadJson?: string): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const admin = await assertAdmin();
  await loadRegistry();
  const wf = await getWorkflow(id);
  if (!wf) return { ok: false, error: "not found" };
  let payload: Record<string, unknown>;
  if (payloadJson?.trim()) {
    try {
      payload = z.record(z.string(), z.unknown()).parse(JSON.parse(payloadJson));
    } catch {
      return { ok: false, error: "invalid JSON" };
    }
  } else {
    payload = { ...(getTrigger(wf.trigger.type)?.samplePayload ?? {}) };
  }
  if (wf.trigger.type === "manual") payload = { input: payload.input ?? payload, startedBy: admin.id };
  const runId = await startRun(wf, payload, { triggeredBy: admin.id });
  if (!runId) return { ok: false, error: "run not created" };
  revalidatePath(`/admin/workflows/${id}`);
  return { ok: true, runId };
}

/** Re-runs a finished run with the same trigger event. */
export async function retryRunAction(runId: string): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const admin = await assertAdmin();
  const run = await getRunWithSteps(runId);
  if (!run) return { ok: false, error: "not found" };
  const wf = await getWorkflow(run.workflowId);
  if (!wf) return { ok: false, error: "workflow missing" };
  const newId = await startRun(wf, run.triggerEvent, { triggeredBy: run.triggeredBy ?? admin.id, parentRunId: run.id, depth: run.depth });
  if (!newId) return { ok: false, error: "run not created" };
  revalidatePath(`/admin/workflows/${wf.id}`);
  return { ok: true, runId: newId };
}
