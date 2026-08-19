import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiAuth } from "@/server/domain/api-keys";
import { hasScope, type ApiScope } from "@/server/domain/api-keys";
import { getQuestionWithResponses, listQuestions } from "@/server/domain/questions";
import { listProviders } from "@/server/llm/providers";
import { modelCapabilities } from "@/server/llm/client";
import { getEditorCatalog } from "@/server/workflows/catalog";
import { validateDefinition } from "@/server/workflows/definitions";
import { startRun } from "@/server/workflows/dispatch";
import { getAction, getTrigger, loadRegistry } from "@/server/workflows/registry";
import { createWorkflow, deleteWorkflow, getRunWithSteps, getWorkflow, listRuns, listWorkflowVersions, listWorkflows, setWorkflowStatus, toDefinition, updateWorkflow, workflowStats } from "@/server/workflows/service";
import { db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";

/**
 * MCP server for the workflow engine room. One instance per request (stateless transport).
 * All tool names, fields and docs are English. Scopes gate write/trigger operations.
 */
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true as const });

function require(auth: ApiAuth, scope: ApiScope) {
  if (!hasScope(auth, scope)) throw new Error(`API key lacks scope "${scope}"`);
}

async function audit(auth: ApiAuth, action: string, targetId: string | null, details: Record<string, unknown> = {}) {
  await db.insert(auditLog).values({ actorId: auth.user.id, action, targetType: "workflow", targetId, details: { ...details, via: "mcp", apiKeyId: auth.key.id } }).catch(() => {});
}

const WORKFLOW_SCHEMA_DOC = `# AI-Up workflow definition

A workflow = one trigger + an ordered list of steps (actions). Stored as JSON:

{
  "name": "Summarize saved links",
  "description": "optional – shown to members",
  "trigger": { "type": "content.created", "config": { "contentTypes": ["link"], "areaIds": [] } },
  "steps": [
    { "id": "read",    "action": "read_webpage", "config": { "url": "{{ trigger.content.url }}" } },
    { "id": "summary", "action": "llm", "config": { "providerId": "default", "model": "default",
        "systemPrompt": "You are the assistant of {{ app.name }}. Purpose: {{ app.purpose }}",
        "prompt": "Summarize in German:\\n\\n{{ steps.read.output.markdown }}",
        "temperature": 0.3,
        "outputSchema": { "type": "object", "properties": { "summary": { "type": "string" } }, "required": ["summary"] } } },
    { "id": "notify",  "action": "notify_user", "config": { "audience": { "type": "triggerUser", "userIds": [] },
        "title": "Summary ready: {{ trigger.content.title }}", "body": "{{ steps.summary.output.json.summary }}", "href": "{{ trigger.content.href }}" } }
  ]
}

Rules
- step.id: ^[a-z][a-z0-9_]{0,39}$, unique; later steps reference earlier ones via {{ steps.<id>.output.* }}.
- Templates are LiquidJS: {{ trigger.* }}, {{ steps.<id>.output.* }}, {{ app.name }}, {{ app.purpose }}, {{ app.url }}, {{ run.id }}, {{ now }}.
  Filters: default, truncate_chars: N, json, upcase/downcase, plus all Liquid standard filters.
- Optional per step: "name" (label), "condition" (Liquid expression; step runs if it renders truthy), "onError": "stop" | "continue".
- Use list_triggers / list_actions / describe_action for config fields and output variables.
- New workflows are created as draft; call set_workflow_status(id, "active") to enable them.
- question flow: an ask_user step with questionKey "X" + a second workflow with trigger question.answered { questionKey: "X" }.
`;

export async function buildMcpServer(auth: ApiAuth): Promise<McpServer> {
  await loadRegistry();
  const server = new McpServer({ name: "ai-up", version: "0.1.0" }, { instructions: "AI-Up workflow engine room. Use list_triggers/list_actions first, then create_workflow/update_workflow. Read resource aiup://docs/workflow-schema for the definition format." });

  server.registerResource("workflow-schema", "aiup://docs/workflow-schema", { title: "Workflow definition format", description: "How workflow JSON definitions are structured, with templates and rules.", mimeType: "text/markdown" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: WORKFLOW_SCHEMA_DOC }],
  }));

  // ---- catalog -------------------------------------------------------------
  server.registerTool("list_triggers", { title: "List triggers", description: "All trigger types with config fields, payload variables and a sample payload.", inputSchema: {} }, async () => {
    const c = await getEditorCatalog();
    return text(c.triggers.map((t) => ({ type: t.type, name: t.labels.name.en, description: t.labels.description.en, doc: t.doc, fields: t.fields.map(fieldDoc), payload: t.payloadDoc, samplePayload: t.samplePayload })));
  });
  server.registerTool("list_actions", { title: "List actions", description: "All action types with config fields and output variables.", inputSchema: {} }, async () => {
    const c = await getEditorCatalog();
    return text(c.actions.map((a) => ({ type: a.type, name: a.labels.name.en, description: a.labels.description.en, doc: a.doc, fields: a.fields.map(fieldDoc), output: a.outputDoc })));
  });
  server.registerTool(
    "describe_action",
    { title: "Describe action", description: "Detailed config documentation for one action type. For `llm`, pass providerId/model to get the options that model supports.", inputSchema: { type: z.string().describe("action type, e.g. llm"), providerId: z.string().optional(), model: z.string().optional() } },
    async ({ type, providerId, model }) => {
      const a = getAction(type);
      if (!a) return fail(`unknown action "${type}"`);
      const base = { type: a.type, doc: a.doc, fields: a.fields.map(fieldDoc), output: a.outputDoc, timeoutMs: a.timeoutMs, templateKeys: a.templateKeys };
      if (type === "llm") {
        const providers = await listProviders();
        const p = providerId && providerId !== "default" ? providers.find((x) => x.id === providerId) : (providers.find((x) => x.isDefault) ?? providers[0]);
        if (!p) return text({ ...base, note: "No LLM provider configured yet (Admin → LLM)." });
        const m = model && model !== "default" ? model : p.defaultModel;
        const info = p.availableModels.find((x) => x.id === m);
        return text({ ...base, provider: { id: p.id, name: p.name, kind: p.kind, defaultModel: p.defaultModel, enabledModels: p.enabledModels }, model: m, capabilities: modelCapabilities(info, p.kind), modelInfo: info ?? null });
      }
      return text(base);
    },
  );
  server.registerTool("describe_trigger", { title: "Describe trigger", description: "Detailed documentation for one trigger type.", inputSchema: { type: z.string() } }, async ({ type }) => {
    const t = getTrigger(type);
    if (!t) return fail(`unknown trigger "${type}"`);
    return text({ type: t.type, doc: t.doc, fields: t.fields.map(fieldDoc), payload: t.payloadDoc, samplePayload: t.samplePayload });
  });

  // ---- LLM ------------------------------------------------------------------
  server.registerTool("list_llm_providers", { title: "List LLM providers", description: "Configured OpenAI-compatible providers with enabled models (no secrets).", inputSchema: {} }, async () => {
    require(auth, "llm:read");
    const providers = await listProviders();
    return text(providers.map((p) => ({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, isDefault: p.isDefault, defaultModel: p.defaultModel, enabledModels: p.enabledModels, hasApiKey: p.hasApiKey })));
  });
  server.registerTool("list_llm_models", { title: "List LLM models", description: "Models of a provider (enabled ones first) with capabilities.", inputSchema: { providerId: z.string().optional().describe("omit for the default provider"), onlyEnabled: z.boolean().optional() } }, async ({ providerId, onlyEnabled }) => {
    require(auth, "llm:read");
    const providers = await listProviders();
    const p = providerId && providerId !== "default" ? providers.find((x) => x.id === providerId) : (providers.find((x) => x.isDefault) ?? providers[0]);
    if (!p) return fail("provider not found");
    const models = p.availableModels.filter((m) => !onlyEnabled || p.enabledModels.includes(m.id)).map((m) => ({ ...m, enabled: p.enabledModels.includes(m.id), capabilities: modelCapabilities(m, p.kind) }));
    return text({ provider: p.name, defaultModel: p.defaultModel, models });
  });

  // ---- workflows ------------------------------------------------------------
  server.registerTool("list_workflows", { title: "List workflows", description: "All workflows with status, trigger, step count and run stats.", inputSchema: { status: z.enum(["draft", "active", "paused"]).optional() } }, async ({ status }) => {
    require(auth, "workflows:read");
    const items = await listWorkflows();
    return text(items.filter((w) => !status || w.status === status).map((w) => ({ id: w.id, name: w.name, description: w.description, status: w.status, version: w.version, trigger: w.trigger, steps: w.steps.map((s) => ({ id: s.id, action: s.action })), runCount: w.runCount, successCount: w.successCount, lastRunAt: w.lastRunAt, lastRunStatus: w.lastRunStatus, updatedAt: w.updatedAt })));
  });
  server.registerTool("get_workflow", { title: "Get workflow", description: "Full definition of a workflow (trigger + steps with configs) plus version history.", inputSchema: { id: z.string().uuid() } }, async ({ id }) => {
    require(auth, "workflows:read");
    const w = await getWorkflow(id);
    if (!w) return fail("workflow not found");
    const versions = await listWorkflowVersions(id);
    return text({ id: w.id, status: w.status, version: w.version, toastAudience: w.toastAudience, definition: toDefinition(w), versions: versions.map((v) => ({ version: v.version, source: v.source, changeNote: v.changeNote, createdAt: v.createdAt })), updatedAt: w.updatedAt, createdAt: w.createdAt });
  });
  server.registerTool("validate_workflow", { title: "Validate workflow", description: "Dry-run validation of a definition (trigger/action configs, step references). Returns issues and warnings.", inputSchema: { definition: z.record(z.string(), z.unknown()) } }, async ({ definition }) => text(validateDefinition(definition)));
  server.registerTool("create_workflow", { title: "Create workflow", description: "Creates a workflow from a definition (see resource aiup://docs/workflow-schema). Starts as draft unless activate=true.", inputSchema: { definition: z.record(z.string(), z.unknown()), activate: z.boolean().optional(), changeNote: z.string().optional() } }, async ({ definition, activate, changeNote }) => {
    require(auth, "workflows:write");
    const res = await createWorkflow(definition, auth.user.id, "mcp", { status: activate ? "active" : "draft", changeNote });
    if (!res.ok) return fail(JSON.stringify({ issues: res.issues }, null, 2));
    await audit(auth, "workflow.created", res.workflow.id, { name: res.workflow.name });
    return text({ id: res.workflow.id, status: res.workflow.status, version: res.workflow.version, warnings: res.warnings });
  });
  server.registerTool(
    "update_workflow",
    { title: "Update workflow", description: "Replaces the definition (new version). Pass the full definition or a partial patch ({name?, description?, trigger?, steps?}) – partial patches are merged onto the current definition. To edit one step, fetch the workflow, modify the step and send the whole steps array.", inputSchema: { id: z.string().uuid(), definition: z.record(z.string(), z.unknown()).optional(), patch: z.record(z.string(), z.unknown()).optional(), changeNote: z.string().optional() } },
    async ({ id, definition, patch, changeNote }) => {
      require(auth, "workflows:write");
      const existing = await getWorkflow(id);
      if (!existing) return fail("workflow not found");
      const next = definition ?? { ...toDefinition(existing), ...(patch ?? {}) };
      const res = await updateWorkflow(id, next, auth.user.id, "mcp", { changeNote });
      if (!res.ok) return fail(JSON.stringify({ issues: res.issues }, null, 2));
      await audit(auth, "workflow.updated", id, { version: res.workflow.version });
      return text({ id, version: res.workflow.version, status: res.workflow.status, warnings: res.warnings });
    },
  );
  server.registerTool("set_workflow_status", { title: "Set workflow status", description: "Activate or pause a workflow.", inputSchema: { id: z.string().uuid(), status: z.enum(["active", "paused", "draft"]) } }, async ({ id, status }) => {
    require(auth, "workflows:write");
    const w = await setWorkflowStatus(id, status, auth.user.id);
    if (!w) return fail("workflow not found");
    return text({ id, status: w.status });
  });
  server.registerTool("delete_workflow", { title: "Delete workflow", description: "Deletes a workflow and its run history. Irreversible.", inputSchema: { id: z.string().uuid(), confirm: z.literal(true).describe("must be true") } }, async ({ id }) => {
    require(auth, "workflows:write");
    const w = await getWorkflow(id);
    if (!w) return fail("workflow not found");
    await deleteWorkflow(id, auth.user.id);
    await audit(auth, "workflow.deleted", id, { name: w.name });
    return text({ deleted: id });
  });

  // ---- runs -----------------------------------------------------------------
  server.registerTool("list_runs", { title: "List runs", description: "Recent runs, optionally filtered by workflow/status.", inputSchema: { workflowId: z.string().uuid().optional(), status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]).optional(), limit: z.number().int().min(1).max(200).optional(), sinceHours: z.number().min(0).optional() } }, async ({ workflowId, status, limit, sinceHours }) => {
    require(auth, "runs:read");
    const runs = await listRuns({ workflowId, status, limit: limit ?? 50, since: sinceHours ? new Date(Date.now() - sinceHours * 3_600_000) : undefined });
    return text(runs.map((r) => ({ id: r.id, workflowId: r.workflowId, workflowName: r.workflowName, status: r.status, triggerType: r.triggerType, error: r.error, durationMs: r.durationMs, createdAt: r.createdAt, finishedAt: r.finishedAt })));
  });
  server.registerTool("get_run", { title: "Get run", description: "One run with trigger event and every step's input/output/usage.", inputSchema: { runId: z.string().uuid() } }, async ({ runId }) => {
    require(auth, "runs:read");
    const run = await getRunWithSteps(runId);
    if (!run) return fail("run not found");
    return text(run);
  });
  server.registerTool("trigger_workflow", { title: "Trigger workflow", description: "Starts a run now. `input` becomes the trigger payload (for manual triggers: {{ trigger.input }}); omit to use the trigger's sample payload.", inputSchema: { id: z.string().uuid(), input: z.record(z.string(), z.unknown()).optional() } }, async ({ id, input }) => {
    require(auth, "runs:trigger");
    const w = await getWorkflow(id);
    if (!w) return fail("workflow not found");
    let payload: Record<string, unknown> = input ?? { ...(getTrigger(w.trigger.type)?.samplePayload ?? {}) };
    if (w.trigger.type === "manual") payload = { input: input ?? {}, startedBy: auth.user.id };
    const runId = await startRun(w, payload, { triggeredBy: auth.user.id });
    return runId ? text({ runId }) : fail("run not created");
  });
  server.registerTool("get_workflow_stats", { title: "Workflow statistics", description: "Runs, success rate, durations, tokens and errors for one workflow (or all when id omitted).", inputSchema: { id: z.string().uuid().optional(), days: z.number().int().min(1).max(90).optional() } }, async ({ id, days }) => {
    require(auth, "runs:read");
    return text(await workflowStats(id ?? null, days ?? 14));
  });

  // ---- questions ------------------------------------------------------------
  server.registerTool("list_questions", { title: "List questions", description: "Questions created by ask_user steps with response counts.", inputSchema: { questionKey: z.string().optional(), limit: z.number().int().min(1).max(200).optional() } }, async ({ questionKey, limit }) => {
    require(auth, "questions:read");
    const items = await listQuestions({ questionKey, limit });
    return text(items.map((q) => ({ id: q.id, questionKey: q.questionKey, title: q.title, workflowName: q.workflowName, fields: q.fields, audience: q.audience, responseCount: q.responseCount, closedAt: q.closedAt, expiresAt: q.expiresAt, createdAt: q.createdAt })));
  });
  server.registerTool("get_question_results", { title: "Question results", description: "Distribution and individual answers for a question.", inputSchema: { questionId: z.string().uuid() } }, async ({ questionId }) => {
    require(auth, "questions:read");
    const r = await getQuestionWithResponses(questionId);
    if (!r) return fail("question not found");
    return text({ question: { id: r.question.id, questionKey: r.question.questionKey, title: r.question.title, fields: r.question.fields, open: r.open }, stats: r.stats, responses: r.responses.map((x) => ({ user: x.user.name, answers: x.answers, at: x.createdAt })) });
  });

  return server;
}

function fieldDoc(f: { key: string; type: string; required?: boolean; label: { en: string }; help?: { en: string }; options?: { value: string; label: { en: string } }[] }) {
  return { key: f.key, type: f.type, required: !!f.required, label: f.label.en, help: f.help?.en, options: f.options?.map((o) => o.value) };
}
