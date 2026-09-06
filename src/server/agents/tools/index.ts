import { z } from "zod";
import { getAreaById, getAreaBySlug, getContent, listAreas, listContents } from "@/server/domain/knowledge";
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
  threadId: string;
  /** collections the agent may read; empty = every collection */
  readAreaIds: string[];
  /** collections it may write (phase D) */
  writeAreaIds: string[];
};

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
