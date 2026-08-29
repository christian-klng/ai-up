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
import { loadAppSettings, updateAppSettings } from "@/server/domain/settings";
import { getCurrentLandingVersion, isPageEnabled, listLandingMedia, listLandingVersions, pageEnabledColumn, restoreLandingVersion, saveLandingVersion } from "@/server/domain/landing";
import { LANDING_ICONS, SITE_PAGES, validateLandingDefinition } from "@/lib/landing-schema";
import { addContentVersion, createContent, getAreaById, getAreaBySlug, getContent, listAreas, listContents, type ContentVersionInput } from "@/server/domain/knowledge";
import { buildStructuredVersionInput } from "@/server/domain/structured-entries";
import { deleteTemplate, getTemplateById, getTemplateBySystemKey, isTemplateAvailableForArea, listAllAssignments, listAvailableTemplates, listTemplates, saveTemplate, setAreaTemplates } from "@/server/domain/templates";
import { isSystemTemplateKey } from "@/lib/structures/defaults";
import { validateStructure } from "@/lib/structures/validate";
import type { ContentTemplate, KnowledgeArea } from "@/server/db/schema";

/**
 * MCP server for the workflow engine room. One instance per request (stateless transport).
 * All tool names, fields and docs are English. Scopes gate write/trigger operations.
 */
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true as const });

function require(auth: ApiAuth, scope: ApiScope) {
  if (!hasScope(auth, scope)) throw new Error(`API key lacks scope "${scope}"`);
}

async function audit(auth: ApiAuth, action: string, targetId: string | null, details: Record<string, unknown> = {}, targetType = "workflow") {
  await db.insert(auditLog).values({ actorId: auth.user.id, action, targetType, targetId, details: { ...details, via: "mcp", apiKeyId: auth.key.id } }).catch(() => {});
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

const PAGES_SCHEMA_DOC = `# AI-Up public site pages (landing, imprint, privacy)

Three public pages share one structured JSON format, per-page versioning and one image pool:
- page "landing" at "/" (when disabled, "/" redirects to login resp. the app home)
- page "imprint" at "/imprint" (404 while disabled)
- page "privacy" at "/privacy" (404 while disabled)
Sections carry copy and structure only. Colors, typography, radius, dark mode and the logo
come from the app theme automatically: write copy, don't style.

{
  "meta": { "title": "optional SEO title (max 70)", "description": "optional SEO description (max 160)" },
  "sections": [
    { "type": "hero", "headline": "…", "subline": "optional", "showLogo": true,
      "primaryCta": { "label": "Join us", "href": "/register" }, "secondaryCta": { "label": "Sign in", "href": "/login" },
      "imageMediaId": "optional uuid" },
    { "type": "features", "title": "optional", "intro": "optional",
      "items": [ { "icon": "sparkles", "title": "…", "text": "…" } ] },
    { "type": "markdown", "title": "optional", "body": "GFM markdown, max 8000 chars; raw HTML is stripped" },
    { "type": "cta", "headline": "…", "text": "optional", "button": { "label": "…", "href": "/register" } },
    { "type": "faq", "title": "optional", "items": [ { "question": "…", "answer": "…" } ] },
    { "type": "image", "mediaId": "uuid", "alt": "required alt text", "caption": "optional" }
  ],
  "footer": { "text": "optional", "links": [ { "label": "Impressum", "href": "https://…" } ] }
}

Rules
- 1–15 sections; landing typically: hero first, then features/markdown, a cta, faq, footer.
  Imprint/privacy pages are usually just markdown sections (plus a minimal footer).
- hrefs: internal path ("/register", "/login", "/imprint", "/privacy") or https:// URL. No other protocols.
- feature icons – allowed values: ${LANDING_ICONS.join(", ")}.
- images: mediaId must reference a media file with purpose "landing" – one shared pool for all pages
  (admin uploads them under Admin → Web pages, or use list_page_media). Other purposes are not public.
- German sites typically need imprint + privacy pages; link them from the landing footer
  (footer.links → "/imprint", "/privacy").
- Pages are monolingual – write them in the community's language (see current app context below).
- Every update creates a new version per page (traceable, restorable). Validate first with validate_page.
- A page only goes public when the admin (or set_page_enabled) turns it on; each page has its own flag.
`;

const COLLECTIONS_DOC = `# AI-Up collections, templates and entries

Collections ("Sammlungen") are admin-created content categories. Entries are created from
**templates** ("Vorlagen"): standalone, versioned form definitions administered separately and
assigned per collection. A collection with NO assigned templates offers the four seeded system
templates (systemKey "text", "image", "link", "video" – not editable or deletable). Every entry
stores a full snapshot of its template definition, so template changes never break entries.

## Template definition

{
  "formatVersion": 1,
  "intro": "optional markdown shown above the form and in every entry",
  "elements": [ /* 1..100 elements, see below */ ]
}

Every element: { "key": "^[a-z][a-z0-9_]{0,39}$ (unique)", "type": "…", "label": "…",
"help": "optional", "required": true|false, "showIf": optional (see below) }.

Element types and their extra config:
- "info":     { "body": "markdown, shown as explanation – collects no answer" }
- "text":     { "placeholder"?, "maxLength"? }               → answer: string
- "textarea": { "placeholder"?, "maxLength"? }               → answer: string
- "markdown": { "placeholder"?, "maxLength"?, "multiple"? }  → answer: string (long markdown body,
              rendered verbatim without a heading). With "multiple": true the element is an
              accordion list of sections → answer: [{ "title": "…", "body": "…" }] (both required
              per section; members can add, remove and reorder sections; rendered as "## title" blocks)
- "select":   { "options": ["…"], "placeholder"? }           → answer: one of options
- "chips":    { "options": ["…"], "minSelected"?, "maxSelected"? } → answer: string[] (subset of options)
- "checkbox": {}                                             → answer: boolean
- "qa":       { "questionLabel"?, "answerLabel"?, "minPairs"?, "maxPairs"? }
              → answer: [{ "question": "…", "answer": "…" }]
- "process":  { "seed": <graph> } – an editable branching process diagram. Graph shape:
              { "nodes": [{ "id", "label", "description"?, "kind": "start"|"step"|"decision"|"end", "x", "y" }],
                "edges": [{ "id", "from", "to", "condition"? }] }
              → answer: a full graph (members start from a copy of the seed). Exactly one start node;
              x/y are layout coordinates (~90px vertical spacing works well).
- "image":    {} → answer: { "mediaId"?: uuid, "url"?: "https://…", "alt"?: "…" } – exactly one of
              mediaId (uploaded file) or url. The server verifies uploads and public URLs.
- "link":     {} → answer: { "url": "https://…" } – the server fetches an Open Graph preview.
- "video":    {} → answer: { "mediaId"?: uuid, "url"?: "https://…" } – exactly one; URLs support
              YouTube, Vimeo and direct video files.

showIf makes an element conditional on an EARLIER answerable element – exactly one operator:
- { "key": "other_key", "equals": "value" }   (text/textarea/select; boolean for checkbox)
- { "key": "chips_key", "includes": "value" } (chips membership)
- { "key": "other_key", "notEmpty": true }    (any answered value)

## Entries

- create_entry: pass "template" (template id or systemKey) plus "answers" keyed by element key
  (call get_template first). The template must be available in the target collection – assigned
  there, or a system template in a collection without assignments. Shortcut for simple content:
  type "markdown" (+body) or "link" (+url, optional body as note) maps to the system templates
  and skips the availability check (meant for automation).
- The server validates answers, enriches media/link answers (previews, embed ids), renders
  deterministic markdown (process graphs as a mermaid flowchart plus a text outline) and stores
  answers + a full snapshot of the definition with the entry. Edits validate against the entry's
  own snapshot; pass upgrade=true on update_entry to re-snapshot to the template's current
  version (answers are then validated against the NEW definition).
- Entries are versioned append-only; every update creates a new version with an optional changeNote.
- Write labels, options and content in the community's language (see context below).
- save_template creates a new template version; entries keep their snapshot until upgraded.
- set_collection_templates assigns templates to a collection (empty list = system templates).
`;

/** Current templates and collections appended to the doc so the calling LLM knows ids, slugs and versions. */
async function collectionsContext(): Promise<string> {
  const [settings, areas, templates, assignments] = await Promise.all([loadAppSettings(), listAreas(), listTemplates(), listAllAssignments()]);
  const templateLines = templates.map((t) => `- ${t.name} (id ${t.id}${t.systemKey ? `, systemKey "${t.systemKey}"` : ""}, v${t.version}${t.isSystem ? ", system" : ""})`);
  const areaLines = areas.map((a) => {
    const assigned = assignments.get(a.id);
    const tpl = assigned?.length ? `templates: ${assigned.map((x) => x.name).join(", ")}` : "templates: system defaults";
    return `- ${a.name} (id ${a.id}, slug "${a.slug}", ${a.contentCount} entries, ${tpl}): ${a.purpose.slice(0, 200)}`;
  });
  return [
    "## Current templates",
    ...(templateLines.length ? templateLines : ["(none)"]),
    "## Current collections",
    `App language: ${settings.defaultLocale}. Community purpose: ${settings.purpose?.slice(0, 300) ?? "(none)"}`,
    ...(areaLines.length ? areaLines : ["(no collections yet)"]),
  ].join("\n");
}

/** Current app context appended to the pages doc so the calling LLM knows name, purpose and theme. */
async function pagesContext(): Promise<string> {
  const settings = await loadAppSettings();
  const perPage = await Promise.all(
    SITE_PAGES.map(async (page) => {
      const current = await getCurrentLandingVersion(page);
      return `- page "${page}": enabled ${isPageEnabled(settings, page)}, current version ${current?.version ?? "none (no content yet)"}`;
    }),
  );
  return [
    "## Current app context",
    `- name: ${settings.name}`,
    `- tagline: ${settings.tagline ?? "(none)"}`,
    `- purpose: ${settings.purpose ? settings.purpose.slice(0, 600) : "(none)"}`,
    `- theme: primaryColor ${settings.theme.primaryColor}, mode ${settings.theme.mode}, radius ${settings.theme.radius}rem`,
    `- logo uploaded: ${settings.logoMediaId ? "yes" : "no"}`,
    `- default locale: ${settings.defaultLocale}`,
    ...perPage,
  ].join("\n");
}

export async function buildMcpServer(auth: ApiAuth): Promise<McpServer> {
  await loadRegistry();
  const server = new McpServer(
    { name: "ai-up", version: "0.1.0" },
    {
      instructions:
        "AI-Up workflow engine room. Use list_triggers/list_actions first, then create_workflow/update_workflow. Read resource aiup://docs/workflow-schema for the definition format. Also manages the public site pages (landing, imprint, privacy): read resource aiup://docs/pages first, then get_page / validate_page / update_page. Content collections (templates + entries): read resource aiup://docs/collections first, then list_collections / list_templates / get_template / save_template / set_collection_templates / create_entry / update_entry.",
    },
  );

  server.registerResource("workflow-schema", "aiup://docs/workflow-schema", { title: "Workflow definition format", description: "How workflow JSON definitions are structured, with templates and rules.", mimeType: "text/markdown" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: WORKFLOW_SCHEMA_DOC }],
  }));

  server.registerResource(
    "pages",
    "aiup://docs/pages",
    { title: "Site pages format & design rules", description: "Section schema, design rules and the current app context (name, purpose, theme) for the public pages: landing, imprint, privacy.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: `${PAGES_SCHEMA_DOC}\n${await pagesContext()}` }] }),
  );

  server.registerResource(
    "collections",
    "aiup://docs/collections",
    { title: "Collections, templates & entries", description: "Template definition format, answer shapes and rules for content collections, plus the current templates and collections.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: `${COLLECTIONS_DOC}\n${await collectionsContext()}` }] }),
  );

  // ---- catalog -------------------------------------------------------------
  server.registerTool("list_triggers", { title: "Workflows - List triggers", description: "All trigger types with config fields, payload variables and a sample payload.", inputSchema: {} }, async () => {
    const c = await getEditorCatalog();
    return text(c.triggers.map((t) => ({ type: t.type, name: t.labels.name.en, description: t.labels.description.en, doc: t.doc, fields: t.fields.map(fieldDoc), payload: t.payloadDoc, samplePayload: t.samplePayload })));
  });
  server.registerTool("list_actions", { title: "Workflows - List actions", description: "All action types with config fields and output variables.", inputSchema: {} }, async () => {
    const c = await getEditorCatalog();
    return text(c.actions.map((a) => ({ type: a.type, name: a.labels.name.en, description: a.labels.description.en, doc: a.doc, fields: a.fields.map(fieldDoc), output: a.outputDoc })));
  });
  server.registerTool(
    "describe_action",
    { title: "Workflows - Describe action", description: "Detailed config documentation for one action type. For `llm`, pass providerId/model to get the options that model supports.", inputSchema: { type: z.string().describe("action type, e.g. llm"), providerId: z.string().optional(), model: z.string().optional() } },
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
  server.registerTool("describe_trigger", { title: "Workflows - Describe trigger", description: "Detailed documentation for one trigger type.", inputSchema: { type: z.string() } }, async ({ type }) => {
    const t = getTrigger(type);
    if (!t) return fail(`unknown trigger "${type}"`);
    return text({ type: t.type, doc: t.doc, fields: t.fields.map(fieldDoc), payload: t.payloadDoc, samplePayload: t.samplePayload });
  });

  // ---- LLM ------------------------------------------------------------------
  server.registerTool("list_llm_providers", { title: "LLM - List providers", description: "Configured OpenAI-compatible providers with enabled models (no secrets).", inputSchema: {} }, async () => {
    require(auth, "llm:read");
    const providers = await listProviders();
    return text(providers.map((p) => ({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, isDefault: p.isDefault, defaultModel: p.defaultModel, enabledModels: p.enabledModels, hasApiKey: p.hasApiKey })));
  });
  server.registerTool("list_llm_models", { title: "LLM - List models", description: "Models of a provider (enabled ones first) with capabilities.", inputSchema: { providerId: z.string().optional().describe("omit for the default provider"), onlyEnabled: z.boolean().optional() } }, async ({ providerId, onlyEnabled }) => {
    require(auth, "llm:read");
    const providers = await listProviders();
    const p = providerId && providerId !== "default" ? providers.find((x) => x.id === providerId) : (providers.find((x) => x.isDefault) ?? providers[0]);
    if (!p) return fail("provider not found");
    const models = p.availableModels.filter((m) => !onlyEnabled || p.enabledModels.includes(m.id)).map((m) => ({ ...m, enabled: p.enabledModels.includes(m.id), capabilities: modelCapabilities(m, p.kind) }));
    return text({ provider: p.name, defaultModel: p.defaultModel, models });
  });

  // ---- workflows ------------------------------------------------------------
  server.registerTool("list_workflows", { title: "Workflows - List workflows", description: "All workflows with status, trigger, step count and run stats.", inputSchema: { status: z.enum(["draft", "active", "paused"]).optional() } }, async ({ status }) => {
    require(auth, "workflows:read");
    const items = await listWorkflows();
    return text(items.filter((w) => !status || w.status === status).map((w) => ({ id: w.id, name: w.name, description: w.description, status: w.status, version: w.version, trigger: w.trigger, steps: w.steps.map((s) => ({ id: s.id, action: s.action })), runCount: w.runCount, successCount: w.successCount, lastRunAt: w.lastRunAt, lastRunStatus: w.lastRunStatus, updatedAt: w.updatedAt })));
  });
  server.registerTool("get_workflow", { title: "Workflows - Get workflow", description: "Full definition of a workflow (trigger + steps with configs) plus version history.", inputSchema: { id: z.string().uuid() } }, async ({ id }) => {
    require(auth, "workflows:read");
    const w = await getWorkflow(id);
    if (!w) return fail("workflow not found");
    const versions = await listWorkflowVersions(id);
    return text({ id: w.id, status: w.status, version: w.version, toastAudience: w.toastAudience, definition: toDefinition(w), versions: versions.map((v) => ({ version: v.version, source: v.source, changeNote: v.changeNote, createdAt: v.createdAt })), updatedAt: w.updatedAt, createdAt: w.createdAt });
  });
  server.registerTool("validate_workflow", { title: "Workflows - Validate workflow", description: "Dry-run validation of a definition (trigger/action configs, step references). Returns issues and warnings.", inputSchema: { definition: z.record(z.string(), z.unknown()) } }, async ({ definition }) => text(validateDefinition(definition)));
  server.registerTool("create_workflow", { title: "Workflows - Create workflow", description: "Creates a workflow from a definition (see resource aiup://docs/workflow-schema). Starts as draft unless activate=true.", inputSchema: { definition: z.record(z.string(), z.unknown()), activate: z.boolean().optional(), changeNote: z.string().optional() } }, async ({ definition, activate, changeNote }) => {
    require(auth, "workflows:write");
    const res = await createWorkflow(definition, auth.user.id, "mcp", { status: activate ? "active" : "draft", changeNote });
    if (!res.ok) return fail(JSON.stringify({ issues: res.issues }, null, 2));
    await audit(auth, "workflow.created", res.workflow.id, { name: res.workflow.name });
    return text({ id: res.workflow.id, status: res.workflow.status, version: res.workflow.version, warnings: res.warnings });
  });
  server.registerTool(
    "update_workflow",
    { title: "Workflows - Update workflow", description: "Replaces the definition (new version). Pass the full definition or a partial patch ({name?, description?, trigger?, steps?}) – partial patches are merged onto the current definition. To edit one step, fetch the workflow, modify the step and send the whole steps array.", inputSchema: { id: z.string().uuid(), definition: z.record(z.string(), z.unknown()).optional(), patch: z.record(z.string(), z.unknown()).optional(), changeNote: z.string().optional() } },
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
  server.registerTool("set_workflow_status", { title: "Workflows - Set status", description: "Activate or pause a workflow.", inputSchema: { id: z.string().uuid(), status: z.enum(["active", "paused", "draft"]) } }, async ({ id, status }) => {
    require(auth, "workflows:write");
    const w = await setWorkflowStatus(id, status, auth.user.id);
    if (!w) return fail("workflow not found");
    return text({ id, status: w.status });
  });
  server.registerTool("delete_workflow", { title: "Workflows - Delete workflow", description: "Deletes a workflow and its run history. Irreversible.", inputSchema: { id: z.string().uuid(), confirm: z.literal(true).describe("must be true") } }, async ({ id }) => {
    require(auth, "workflows:write");
    const w = await getWorkflow(id);
    if (!w) return fail("workflow not found");
    await deleteWorkflow(id, auth.user.id);
    await audit(auth, "workflow.deleted", id, { name: w.name });
    return text({ deleted: id });
  });

  // ---- runs -----------------------------------------------------------------
  server.registerTool("list_runs", { title: "Runs - List runs", description: "Recent runs, optionally filtered by workflow/status.", inputSchema: { workflowId: z.string().uuid().optional(), status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]).optional(), limit: z.number().int().min(1).max(200).optional(), sinceHours: z.number().min(0).optional() } }, async ({ workflowId, status, limit, sinceHours }) => {
    require(auth, "runs:read");
    const runs = await listRuns({ workflowId, status, limit: limit ?? 50, since: sinceHours ? new Date(Date.now() - sinceHours * 3_600_000) : undefined });
    return text(runs.map((r) => ({ id: r.id, workflowId: r.workflowId, workflowName: r.workflowName, status: r.status, triggerType: r.triggerType, error: r.error, durationMs: r.durationMs, createdAt: r.createdAt, finishedAt: r.finishedAt })));
  });
  server.registerTool("get_run", { title: "Runs - Get run", description: "One run with trigger event and every step's input/output/usage.", inputSchema: { runId: z.string().uuid() } }, async ({ runId }) => {
    require(auth, "runs:read");
    const run = await getRunWithSteps(runId);
    if (!run) return fail("run not found");
    return text(run);
  });
  server.registerTool("trigger_workflow", { title: "Runs - Trigger workflow", description: "Starts a run now. `input` becomes the trigger payload (for manual triggers: {{ trigger.input }}); omit to use the trigger's sample payload.", inputSchema: { id: z.string().uuid(), input: z.record(z.string(), z.unknown()).optional() } }, async ({ id, input }) => {
    require(auth, "runs:trigger");
    const w = await getWorkflow(id);
    if (!w) return fail("workflow not found");
    let payload: Record<string, unknown> = input ?? { ...(getTrigger(w.trigger.type)?.samplePayload ?? {}) };
    if (w.trigger.type === "manual") payload = { input: input ?? {}, startedBy: auth.user.id };
    const runId = await startRun(w, payload, { triggeredBy: auth.user.id });
    return runId ? text({ runId }) : fail("run not created");
  });
  server.registerTool("get_workflow_stats", { title: "Runs - Workflow statistics", description: "Runs, success rate, durations, tokens and errors for one workflow (or all when id omitted).", inputSchema: { id: z.string().uuid().optional(), days: z.number().int().min(1).max(90).optional() } }, async ({ id, days }) => {
    require(auth, "runs:read");
    return text(await workflowStats(id ?? null, days ?? 14));
  });

  // ---- site pages (landing, imprint, privacy) -------------------------------
  const pageParam = z.enum(SITE_PAGES).describe("landing | imprint | privacy");
  server.registerTool("get_page", { title: "Pages - Get content", description: "Current definition, enabled state and version of one public page (landing at \"/\", imprint at /imprint, privacy at /privacy). Read resource aiup://docs/pages for the format and design rules.", inputSchema: { page: pageParam } }, async ({ page }) => {
    require(auth, "landing:read");
    const [settings, current] = await Promise.all([loadAppSettings(), getCurrentLandingVersion(page)]);
    return text({ page, enabled: isPageEnabled(settings, page), version: current?.version ?? null, definition: current?.definition ?? null });
  });
  server.registerTool("validate_page", { title: "Pages - Validate", description: "Dry-run validation of a page definition against the shared section schema. Returns issues without saving.", inputSchema: { definition: z.record(z.string(), z.unknown()) } }, async ({ definition }) => text(validateLandingDefinition(definition)));
  server.registerTool(
    "update_page",
    { title: "Pages - Update", description: "Validates and saves the full definition of one page as a new version (append-only history per page; restore is always possible). Does not change the enabled flag.", inputSchema: { page: pageParam, definition: z.record(z.string(), z.unknown()), changeNote: z.string().max(300).optional() } },
    async ({ page, definition, changeNote }) => {
      require(auth, "landing:write");
      const res = await saveLandingVersion(page, definition, auth.user.id, "mcp", changeNote);
      if (!res.ok) return fail(JSON.stringify({ issues: res.issues }, null, 2));
      await audit(auth, "landing.updated", res.row.id, { page, version: res.row.version }, "landing");
      return text({ page, version: res.row.version, warnings: res.warnings });
    },
  );
  server.registerTool("list_page_versions", { title: "Pages - List versions", description: "Version history of one page (source ui/mcp, change notes).", inputSchema: { page: pageParam } }, async ({ page }) => {
    require(auth, "landing:read");
    const versions = await listLandingVersions(page);
    return text(versions.map((v) => ({ version: v.version, source: v.source, changeNote: v.changeNote, changedBy: v.changedByName, createdAt: v.createdAt })));
  });
  server.registerTool("restore_page_version", { title: "Pages - Restore version", description: "Copies an older version of one page forward as its new current version (history stays intact).", inputSchema: { page: pageParam, version: z.number().int().min(1) } }, async ({ page, version }) => {
    require(auth, "landing:write");
    const row = await restoreLandingVersion(page, version, auth.user.id, "mcp");
    if (!row) return fail("version not found");
    await audit(auth, "landing.restored", row.id, { page, restored: version, newVersion: row.version }, "landing");
    return text({ page, version: row.version });
  });
  server.registerTool("set_page_enabled", { title: "Pages - Enable or disable", description: "Turns one public page on or off. Landing off: \"/\" redirects to login resp. the app home; imprint/privacy off: 404.", inputSchema: { page: pageParam, enabled: z.boolean() } }, async ({ page, enabled }) => {
    require(auth, "landing:write");
    if (enabled && !(await getCurrentLandingVersion(page))) return fail(`no content for page "${page}" yet – create a version with update_page first`);
    await updateAppSettings({ [pageEnabledColumn(page)]: enabled });
    await audit(auth, "settings.page.toggled", "default", { page, enabled }, "settings");
    return text({ page, enabled });
  });
  server.registerTool("list_page_media", { title: "Pages - List media", description: "Publicly served images usable on all site pages (reference them as mediaId; one shared pool). Upload new ones under Admin → Web pages.", inputSchema: {} }, async () => {
    require(auth, "landing:read");
    const media = await listLandingMedia();
    return text(media.map((m) => ({ id: m.id, name: m.originalName, mime: m.mime, width: m.width, height: m.height, size: m.size, url: `/api/files/${m.id}` })));
  });

  // ---- collections (knowledge areas, templates, entries) --------------------
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const resolveArea = async (idOrSlug: string): Promise<KnowledgeArea | undefined> => (UUID_RE.test(idOrSlug) ? getAreaById(idOrSlug) : getAreaBySlug(idOrSlug));
  const resolveTemplate = async (idOrKey: string): Promise<ContentTemplate | undefined> =>
    UUID_RE.test(idOrKey) ? getTemplateById(idOrKey) : isSystemTemplateKey(idOrKey) ? getTemplateBySystemKey(idOrKey) : undefined;
  const collectionInput = z.string().describe("collection id (uuid) or slug");
  const templateInput = z.string().describe("template id (uuid) or systemKey (text | image | link | video)");
  const httpUrl = z.string().trim().max(2000).regex(/^https?:\/\//i, "must be an http(s) URL");

  server.registerTool("list_collections", { title: "Collections - List collections", description: "All collections with purpose, entry count and available templates. Read resource aiup://docs/collections for the template format.", inputSchema: {} }, async () => {
    require(auth, "knowledge:read");
    const [areas, assignments] = await Promise.all([listAreas(), listAllAssignments()]);
    return text(
      areas.map((a) => {
        const assigned = assignments.get(a.id);
        return { id: a.id, slug: a.slug, name: a.name, purpose: a.purpose, description: a.description, entryCount: a.contentCount, templates: assigned?.length ? assigned : "system-defaults" };
      }),
    );
  });

  server.registerTool("list_templates", { title: "Templates - List templates", description: "All content templates with version and how many collections they are assigned to.", inputSchema: {} }, async () => {
    require(auth, "knowledge:read");
    const templates = await listTemplates();
    return text(templates.map((t) => ({ id: t.id, name: t.name, description: t.description, systemKey: t.systemKey, isSystem: t.isSystem, version: t.version, assignmentCount: t.assignmentCount, updatedAt: t.updatedAt })));
  });

  server.registerTool("get_template", { title: "Templates - Get template", description: "One template with its full definition (element keys for create_entry answers).", inputSchema: { template: templateInput } }, async ({ template }) => {
    require(auth, "knowledge:read");
    const t = await resolveTemplate(template);
    if (!t) return fail("template not found");
    return text({ id: t.id, name: t.name, description: t.description, systemKey: t.systemKey, isSystem: t.isSystem, version: t.version, definition: t.definition, updatedAt: t.updatedAt });
  });

  server.registerTool("validate_structure", { title: "Templates - Validate definition", description: "Dry-run validation of a template definition. Returns issues (blocking) and warnings without saving.", inputSchema: { definition: z.record(z.string(), z.unknown()) } }, async ({ definition }) => {
    const res = validateStructure(definition);
    return text({ valid: !!res.def, issues: res.issues, warnings: res.warnings });
  });

  server.registerTool(
    "save_template",
    {
      title: "Templates - Save template",
      description: "Creates a template (omit id) or updates one (new version; entries keep their snapshot until they opt into the upgrade). System templates are managed by the application and cannot be changed.",
      inputSchema: { id: z.string().uuid().optional(), name: z.string().trim().min(1).max(200), description: z.string().max(1000).optional(), icon: z.string().max(50).optional(), definition: z.record(z.string(), z.unknown()), changeNote: z.string().max(500).optional() },
    },
    async ({ id, name, description, icon, definition, changeNote }) => {
      require(auth, "knowledge:write");
      const res = validateStructure(definition);
      if (!res.def) return fail(JSON.stringify({ issues: res.issues }, null, 2));
      const saved = await saveTemplate({ id, name, description: description || null, icon, definition: res.def }, auth.user.id, changeNote);
      if ("error" in saved) return fail(saved.error === "system" ? "system templates cannot be changed" : "template not found");
      return text({ id: saved.id, version: saved.version, warnings: res.warnings });
    },
  );

  server.registerTool("delete_template", { title: "Templates - Delete template", description: "Deletes a custom template and removes its collection assignments. Entries keep their snapshots. System templates cannot be deleted.", inputSchema: { id: z.string().uuid(), confirm: z.literal(true).describe("must be true") } }, async ({ id }) => {
    require(auth, "knowledge:write");
    const res = await deleteTemplate(id, auth.user.id);
    if (!res.ok) return fail(res.reason === "system" ? "system templates cannot be deleted" : "template not found");
    return text({ deleted: true, id });
  });

  server.registerTool(
    "set_collection_templates",
    { title: "Collections - Assign templates", description: "Replaces the templates offered in a collection (array order = display order). An empty array reverts to the system templates.", inputSchema: { collection: collectionInput, templateIds: z.array(z.string().uuid()).max(100) } },
    async ({ collection, templateIds }) => {
      require(auth, "knowledge:write");
      const area = await resolveArea(collection);
      if (!area) return fail("collection not found");
      const unique = [...new Set(templateIds)];
      for (const tplId of unique) {
        if (!(await getTemplateById(tplId))) return fail(`template ${tplId} not found`);
      }
      await setAreaTemplates(area.id, unique, auth.user.id);
      return text({ collectionId: area.id, templateIds: unique.length ? unique : "system-defaults" });
    },
  );

  server.registerTool(
    "list_entries",
    { title: "Collections - List entries", description: "Entries of a collection (newest first), optionally filtered by type or full-text query.", inputSchema: { collection: collectionInput, type: z.enum(["markdown", "image", "video", "link", "structured"]).optional(), query: z.string().optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() } },
    async ({ collection, type, query, limit, offset }) => {
      require(auth, "knowledge:read");
      const area = await resolveArea(collection);
      if (!area) return fail("collection not found");
      const items = await listContents({ areaId: area.id, type, query, limit: limit ?? 50, offset });
      return text(items.map((c) => ({ id: c.id, type: c.type, title: c.title, pinned: c.pinned, versionCount: c.versionCount, author: c.author?.name ?? null, structureVersion: c.version?.meta.structure?.structureVersion ?? null, updatedAt: c.updatedAt })));
    },
  );

  server.registerTool("get_entry", { title: "Collections - Get entry", description: "One entry with its markdown body; structured entries include the definition snapshot and the stored answers.", inputSchema: { id: z.string().uuid() } }, async ({ id }) => {
    require(auth, "knowledge:read");
    const c = await getContent(id);
    if (!c) return fail("entry not found");
    const area = await getAreaById(c.areaId);
    const s = c.version?.meta.structure;
    return text({
      id: c.id,
      collectionId: c.areaId,
      collectionSlug: area?.slug ?? null,
      type: c.type,
      title: c.title,
      pinned: c.pinned,
      versionCount: c.versionCount,
      author: c.author?.name ?? null,
      url: c.version?.url ?? null,
      bodyMarkdown: c.version?.bodyMarkdown ?? null,
      structure: s ? { structureVersion: s.structureVersion, definition: s.definition, answers: s.answers } : null,
      updatedAt: c.updatedAt,
    });
  });

  server.registerTool(
    "create_entry",
    {
      title: "Collections - Create entry",
      description:
        "Creates an entry from a template. Pass `template` (id or systemKey) plus `answers` keyed by element key (call get_template first; markdown is generated server-side). Shortcut for automation: type markdown (+body) or link (+url, optional body) maps to the system templates and skips the availability check. With exactly one available template it is used implicitly. The key owner becomes the author.",
      inputSchema: {
        collection: collectionInput,
        title: z.string().trim().min(1).max(200),
        template: templateInput.optional(),
        answers: z.record(z.string(), z.unknown()).optional().describe("{ <element key>: <answer> }"),
        type: z.enum(["markdown", "link"]).optional().describe("shortcut via system templates; default markdown when body/url are used without template/answers"),
        body: z.string().max(200_000).optional().describe("shortcut: markdown body (type markdown) or note (type link)"),
        url: httpUrl.optional().describe("shortcut: type link"),
      },
    },
    async ({ collection, title, template, answers, type, body, url }) => {
      require(auth, "knowledge:write");
      const area = await resolveArea(collection);
      if (!area) return fail("collection not found");

      let tpl: ContentTemplate | undefined;
      let effectiveAnswers: unknown = answers;
      if (template) {
        tpl = await resolveTemplate(template);
        if (!tpl) return fail("template not found");
        if (!(await isTemplateAvailableForArea(area.id, tpl.id))) return fail("template is not available in this collection (assign it via set_collection_templates)");
        if (!answers) return fail("pass `answers` keyed by element key (call get_template for the definition)");
      } else if (type || body !== undefined || url !== undefined) {
        // legacy shortcut: markdown/link content via the system templates (availability check skipped for automation)
        const entryType = type ?? "markdown";
        if (entryType === "markdown") {
          if (!body?.trim()) return fail("type markdown needs a non-empty `body`");
          tpl = await getTemplateBySystemKey("text");
          effectiveAnswers = { body };
        } else {
          if (!url) return fail("type link needs a `url`");
          tpl = await getTemplateBySystemKey("link");
          effectiveAnswers = { url: { url }, ...(body?.trim() ? { note: body } : {}) };
        }
        if (!tpl) return fail("system templates missing – run db:migrate");
      } else {
        const available = await listAvailableTemplates(area.id);
        if (available.length === 1 && answers) {
          tpl = available[0];
        } else {
          return fail("pass `template` (id or systemKey) plus `answers`, or the type/body/url shortcut");
        }
      }

      const built = await buildStructuredVersionInput({ structureId: tpl.id, structureVersion: tpl.version, definition: tpl.definition }, title, effectiveAnswers, {});
      if (!built.ok) return fail(JSON.stringify({ issues: built.issues, hint: "answer keys/shapes must match the template definition" }, null, 2));
      const content = await createContent(area.id, "structured", built.input, auth.user.id);
      await audit(auth, "content.created", content.id, { collection: area.slug, type: "structured", templateId: tpl.id }, "content");
      return text({ id: content.id, type: "structured", href: `/knowledge/${area.slug}/${content.id}` });
    },
  );

  server.registerTool(
    "update_entry",
    {
      title: "Collections - Update entry",
      description:
        "Updates an entry (append-only: creates a new version). Structured entries validate `answers` against the entry's own definition snapshot – omit `answers` to keep the stored ones (e.g. title-only edits); pass upgrade=true (with full `answers`) to re-snapshot to the template's current version. Markdown/link entries accept body/url. Image/video entries only accept title/body.",
      inputSchema: {
        id: z.string().uuid(),
        title: z.string().trim().min(1).max(200).optional(),
        answers: z.record(z.string(), z.unknown()).optional(),
        upgrade: z.boolean().optional().describe("structured entries: validate answers against the template's CURRENT definition and store the new snapshot"),
        body: z.string().max(200_000).optional(),
        url: httpUrl.optional(),
        changeNote: z.string().max(500).optional(),
      },
    },
    async ({ id, title, answers, upgrade, body, url, changeNote }) => {
      require(auth, "knowledge:write");
      const c = await getContent(id);
      if (!c || !c.version) return fail("entry not found");
      const v = c.version;
      const area = await getAreaById(c.areaId);

      const input: ContentVersionInput = { title: title ?? c.title, bodyMarkdown: v.bodyMarkdown, mediaId: v.mediaId, url: v.url, meta: v.meta, changeNote: changeNote ?? null };
      if (c.type === "structured") {
        const prev = v.meta.structure;
        if (!prev) return fail("entry has no structure snapshot");
        let snapshot: Pick<typeof prev, "structureId" | "structureVersion" | "definition"> = prev;
        if (upgrade) {
          const tpl = await getTemplateById(prev.structureId);
          if (!tpl) return fail("the entry's template no longer exists – it keeps its snapshot");
          if (tpl.version <= prev.structureVersion) return fail("entry already uses the template's current version");
          if (!answers) return fail("upgrade needs full `answers` for the template's current definition (call get_template)");
          snapshot = { structureId: tpl.id, structureVersion: tpl.version, definition: tpl.definition };
        }
        const built = await buildStructuredVersionInput(snapshot, title ?? c.title, answers ?? prev.answers, { changeNote: changeNote ?? null, prevEnrichment: prev.enrichment });
        if (!built.ok) return fail(JSON.stringify({ issues: built.issues, hint: upgrade ? "answers are validated against the template's CURRENT definition" : "answers are validated against this entry's own definition snapshot – call get_entry to see it" }, null, 2));
        input.bodyMarkdown = built.input.bodyMarkdown;
        input.meta = { ...v.meta, ...built.input.meta };
      } else {
        if (answers) return fail(`entry type is "${c.type}" – answers are only valid for structured entries`);
        if (body !== undefined) input.bodyMarkdown = body.trim() || null;
        if (url !== undefined) {
          if (c.type !== "link") return fail(`url can only be changed on link entries (type is "${c.type}")`);
          input.url = url;
          if (v.url !== url) input.meta = { ...v.meta, preview: undefined };
        }
        if (c.type === "markdown" && !input.bodyMarkdown) return fail("markdown entries need a non-empty body");
      }

      await addContentVersion(id, input, auth.user.id);
      await audit(auth, "content.updated", id, { collection: area?.slug, type: c.type }, "content");
      return text({ id, versionNo: c.versionCount + 1, href: `/knowledge/${area?.slug ?? c.areaId}/${id}` });
    },
  );

  // ---- questions ------------------------------------------------------------
  server.registerTool("list_questions", { title: "Questions - List questions", description: "Questions created by ask_user steps with response counts.", inputSchema: { questionKey: z.string().optional(), limit: z.number().int().min(1).max(200).optional() } }, async ({ questionKey, limit }) => {
    require(auth, "questions:read");
    const items = await listQuestions({ questionKey, limit });
    return text(items.map((q) => ({ id: q.id, questionKey: q.questionKey, title: q.title, workflowName: q.workflowName, fields: q.fields, audience: q.audience, responseCount: q.responseCount, closedAt: q.closedAt, expiresAt: q.expiresAt, createdAt: q.createdAt })));
  });
  server.registerTool("get_question_results", { title: "Questions - Get results", description: "Distribution and individual answers for a question.", inputSchema: { questionId: z.string().uuid() } }, async ({ questionId }) => {
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
