import { z } from "zod";
import { addContentVersion, canEditContent, createContent, getAreaById, getAreaBySlug, getContent, listAreas, listContents } from "@/server/domain/knowledge";
import { getTemplateById, isTemplateAvailableForArea, listAvailableTemplates } from "@/server/domain/templates";
import { buildStructuredVersionInput } from "@/server/domain/structured-entries";
import { describeStructure } from "./describe";
import type { EventOrigin } from "@/server/events/bus";
import type { ToolDefinition } from "@/server/llm/client";

/**
 * Tools the agent may call. Same shape as the workflow actions registry: zod schema, English
 * `description` for the model, `{de,en}` labels for the UI, `run()` against the domain layer.
 *
 * Two rules hold for every tool:
 *  - it acts as the calling user (`ctx.userId`), never as the bot, so the app's own guards apply
 *    (see docs/ki-agenten.md 1.4);
 *  - it stays inside the thread's collection selection.
 *
 * Runs in the worker – no next/* imports, and never the server actions (those are Next-specific).
 */

export type AgentToolContext = {
  userId: string;
  userRole: "member" | "admin";
  threadId: string;
  agentId: string;
  /** collections the agent may read; empty = every collection */
  readAreaIds: string[];
  /** collections it may write */
  writeAreaIds: string[];
  /** entries touched this turn – the loop enqueues one evaluation each when the turn ends */
  written: Set<string>;
};

/** Writes per turn. A single chat sentence must not be able to rewrite a whole collection. */
export const MAX_WRITES_PER_TURN = 10;

export function agentOrigin(ctx: AgentToolContext): EventOrigin {
  return { kind: "agent", threadId: ctx.threadId, agentId: ctx.agentId, userId: ctx.userId };
}

export type AgentToolDefinition<I = never> = {
  name: string;
  description: string;
  labels: { de: string; en: string };
  schema: z.ZodType<I>;
  access: "read" | "write";
  run(input: I, ctx: AgentToolContext): Promise<string>;
};

const registry = new Map<string, AgentToolDefinition<never>>();

function register<I>(def: AgentToolDefinition<I>): void {
  registry.set(def.name, def as unknown as AgentToolDefinition<never>);
}

export function getTool(name: string): AgentToolDefinition<never> | undefined {
  return registry.get(name);
}

/** Tools available to a thread. Write tools arrive in phase D. */
export function listTools(access: "read" | "write"): AgentToolDefinition<never>[] {
  return [...registry.values()].filter((t) => access === "write" || t.access === "read");
}

/** Registry → OpenAI tool definitions. `$schema` is dropped; providers reject unknown keys. */
export function toolDefinitions(tools: AgentToolDefinition<never>[]): ToolDefinition[] {
  return tools.map((t) => {
    const { $schema, ...parameters } = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
    void $schema;
    return { name: t.name, description: t.description, parameters };
  });
}

/** Entry markdown is capped like in the evaluation – one entry must not eat the whole context. */
const MAX_ENTRY_CHARS = 20_000;

/** Resolves the collection the model named (id or slug) and checks it against the thread's scope. */
async function resolveArea(ref: string | undefined, ctx: AgentToolContext): Promise<{ id: string; name: string } | undefined> {
  if (!ref) return undefined;
  const area = (await getAreaBySlug(ref)) ?? (/^[0-9a-f-]{36}$/i.test(ref) ? await getAreaById(ref) : undefined);
  if (!area) return undefined;
  if (ctx.readAreaIds.length && !ctx.readAreaIds.includes(area.id) && !ctx.writeAreaIds.includes(area.id)) return undefined;
  return { id: area.id, name: area.name };
}

function allowedAreaIds(ctx: AgentToolContext): string[] {
  return [...new Set([...ctx.readAreaIds, ...ctx.writeAreaIds])];
}

/** Writing needs an explicit selection – "no selection = everything" only ever grants reading. */
function mayWrite(areaId: string, ctx: AgentToolContext): boolean {
  return ctx.writeAreaIds.includes(areaId);
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

register({
  name: "list_collections",
  description:
    "Lists the collections this conversation may use, with their purpose and entry count. Call this first when you do not know which collection holds something. The `slug` is what list_entries expects.",
  labels: { de: "Sammlungen auflisten", en: "List collections" },
  schema: z.object({}),
  access: "read",
  async run(_input, ctx) {
    const areas = await listAreas();
    const allowed = allowedAreaIds(ctx);
    const visible = allowed.length ? areas.filter((a) => allowed.includes(a.id)) : areas;
    if (!visible.length) return "No collections available in this conversation.";
    return visible.map((a) => `- ${a.name} (slug: ${a.slug}, entries: ${a.contentCount})\n  purpose: ${a.purpose}`).join("\n");
  },
});

register({
  name: "list_entries",
  description: "Lists entries of one collection (newest first), with id and title. Use get_entry to read one in full.",
  labels: { de: "Einträge auflisten", en: "List entries" },
  schema: z.object({
    collection: z.string().describe("collection slug or id, as returned by list_collections"),
    limit: z.number().int().min(1).max(50).optional().describe("default 25"),
  }),
  access: "read",
  async run(input, ctx) {
    const area = await resolveArea(input.collection, ctx);
    if (!area) return `Collection "${input.collection}" does not exist or is not part of this conversation.`;
    const items = await listContents({ areaId: area.id, limit: input.limit ?? 25, sort: "updated" });
    if (!items.length) return `Collection "${area.name}" has no entries yet.`;
    return items.map((c) => `- ${c.title} (id: ${c.id}${c.pinned ? ", pinned" : ""}, updated: ${c.updatedAt.toISOString().slice(0, 10)})`).join("\n");
  },
});

register({
  name: "search_entries",
  description:
    "Full-text search over entry titles and bodies. Searches every collection of this conversation unless `collection` is given. Matching is literal substring matching, so prefer single distinctive words over sentences.",
  labels: { de: "Einträge durchsuchen", en: "Search entries" },
  schema: z.object({
    query: z.string().min(2).describe("a distinctive word or phrase"),
    collection: z.string().optional().describe("restrict to one collection (slug or id)"),
    limit: z.number().int().min(1).max(50).optional().describe("default 15"),
  }),
  access: "read",
  async run(input, ctx) {
    let areaId: string | undefined;
    if (input.collection) {
      const area = await resolveArea(input.collection, ctx);
      if (!area) return `Collection "${input.collection}" does not exist or is not part of this conversation.`;
      areaId = area.id;
    }
    const items = await listContents({ areaId, query: input.query, limit: input.limit ?? 15 });
    const allowed = allowedAreaIds(ctx);
    const visible = allowed.length ? items.filter((c) => allowed.includes(c.areaId)) : items;
    if (!visible.length) return `No entry matches "${input.query}".`;
    return visible.map((c) => `- ${c.title} (id: ${c.id})`).join("\n");
  },
});

register({
  name: "get_entry",
  description: "Reads one entry in full: title and body as markdown. Cite the entry by its title when you use it.",
  labels: { de: "Eintrag lesen", en: "Read entry" },
  schema: z.object({ id: z.string().describe("entry id from list_entries or search_entries") }),
  access: "read",
  async run(input, ctx) {
    const entry = await getContent(input.id);
    if (!entry) return `No entry with id ${input.id}.`;
    const allowed = allowedAreaIds(ctx);
    if (allowed.length && !allowed.includes(entry.areaId)) return "This entry belongs to a collection that is not part of this conversation.";
    const body = entry.version?.bodyMarkdown ?? entry.version?.url ?? "";
    const truncated = body.length > MAX_ENTRY_CHARS;
    return [`# ${entry.title}`, "", truncated ? `${body.slice(0, MAX_ENTRY_CHARS)}\n\n[…truncated]` : body].join("\n");
  },
});

// ---------------------------------------------------------------------------
// Write tools (curate mode only)
// ---------------------------------------------------------------------------

register({
  name: "list_templates",
  description:
    "Lists the templates available in one collection. Entries are always created from a template, so call this before create_entry and then get_template for the element keys.",
  labels: { de: "Vorlagen auflisten", en: "List templates" },
  schema: z.object({ collection: z.string().describe("collection slug or id") }),
  access: "write",
  async run(input, ctx) {
    const area = await resolveArea(input.collection, ctx);
    if (!area) return `Collection "${input.collection}" does not exist or is not part of this conversation.`;
    const templates = await listAvailableTemplates(area.id);
    if (!templates.length) return `Collection "${area.name}" offers no templates.`;
    return templates.map((t) => `- ${t.name} (id: ${t.id}, version: ${t.version})${t.description ? `\n  ${t.description}` : ""}`).join("\n");
  },
});

register({
  name: "get_template",
  description:
    "Describes a template: which elements it has, their keys, types and whether they are required. `answers` in create_entry is keyed by these element keys.",
  labels: { de: "Vorlage ansehen", en: "Read template" },
  schema: z.object({ templateId: z.string().describe("template id from list_templates") }),
  access: "write",
  async run(input) {
    const tpl = await getTemplateById(input.templateId);
    if (!tpl) return `No template with id ${input.templateId}.`;
    return describeStructure(tpl.name, tpl.definition);
  },
});

register({
  name: "create_entry",
  description:
    "Creates an entry in a collection from a template. `answers` is an object keyed by the element keys from get_template. The entry is saved immediately and visible to everyone; its markdown body is generated from the answers.",
  labels: { de: "Eintrag anlegen", en: "Create entry" },
  schema: z.object({
    collection: z.string().describe("collection slug or id"),
    templateId: z.string().describe("template id from list_templates"),
    title: z.string().min(1).max(200),
    answers: z.record(z.string(), z.unknown()).describe("{ <element key>: <answer> } – see get_template"),
  }),
  access: "write",
  async run(input, ctx) {
    if (ctx.written.size >= MAX_WRITES_PER_TURN) return `Write limit of ${MAX_WRITES_PER_TURN} entries per answer reached. Tell the user what is still missing.`;
    const area = await resolveArea(input.collection, ctx);
    if (!area) return `Collection "${input.collection}" does not exist or is not part of this conversation.`;
    if (!mayWrite(area.id, ctx)) return `Collection "${area.name}" is read-only in this conversation. The user can allow writing in the panel on the right.`;
    const tpl = await getTemplateById(input.templateId);
    if (!tpl) return `No template with id ${input.templateId}.`;
    if (!(await isTemplateAvailableForArea(area.id, tpl.id))) return `Template "${tpl.name}" is not available in collection "${area.name}".`;

    const built = await buildStructuredVersionInput({ structureId: tpl.id, structureVersion: tpl.version, definition: tpl.definition }, input.title, input.answers);
    if (!built.ok) return `The answers do not fit the template:\n${built.issues.map((i) => `- ${i.key}: ${i.code}${i.count === undefined ? "" : ` (${i.count})`}`).join("\n")}`;
    const content = await createContent(area.id, "structured", built.input, ctx.userId, agentOrigin(ctx));
    ctx.written.add(content.id);
    return `Created "${content.title}" in ${area.name} (id: ${content.id}).`;
  },
});

register({
  name: "update_entry",
  description:
    "Updates an entry as a new version (the history is kept). `answers` is validated against the entry's own template snapshot; omit it to change only the title. Read the entry with get_entry first.",
  labels: { de: "Eintrag bearbeiten", en: "Update entry" },
  schema: z.object({
    id: z.string().describe("entry id"),
    title: z.string().min(1).max(200).optional(),
    answers: z.record(z.string(), z.unknown()).optional().describe("full answers; omit to keep the stored ones"),
    changeNote: z.string().max(500).optional().describe("one line on what changed – shows up in the history"),
  }),
  access: "write",
  async run(input, ctx) {
    if (ctx.written.size >= MAX_WRITES_PER_TURN) return `Write limit of ${MAX_WRITES_PER_TURN} entries per answer reached. Tell the user what is still missing.`;
    const entry = await getContent(input.id);
    if (!entry || !entry.version) return `No entry with id ${input.id}.`;
    if (!mayWrite(entry.areaId, ctx)) return "This entry belongs to a collection that is read-only in this conversation.";
    // The agent acts for the user, so the app's own rule decides (docs/ki-agenten.md 1.4).
    if (!canEditContent({ id: ctx.userId, role: ctx.userRole }, entry)) return "The user may not edit this entry – only its author or an admin can.";
    const snapshot = entry.version.meta.structure;
    if (entry.type !== "structured" || !snapshot) return `Entry "${entry.title}" was not created from a template and cannot be edited here.`;

    const built = await buildStructuredVersionInput(
      { structureId: snapshot.structureId, structureVersion: snapshot.structureVersion, definition: snapshot.definition },
      input.title ?? entry.title,
      input.answers ?? snapshot.answers,
      { changeNote: input.changeNote ?? null, prevEnrichment: snapshot.enrichment, imageMediaId: entry.version.mediaId },
    );
    if (!built.ok) return `The answers do not fit the entry's template:\n${built.issues.map((i) => `- ${i.key}: ${i.code}${i.count === undefined ? "" : ` (${i.count})`}`).join("\n")}`;
    const updated = await addContentVersion(entry.id, { ...built.input, meta: { ...entry.version.meta, ...built.input.meta } }, ctx.userId, agentOrigin(ctx));
    if (!updated) return `Entry ${input.id} could not be updated.`;
    ctx.written.add(updated.id);
    return `Updated "${updated.title}" (version ${updated.versionCount}).`;
  },
});
