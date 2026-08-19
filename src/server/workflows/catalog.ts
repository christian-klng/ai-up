import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { listAreas } from "@/server/domain/knowledge";
import { listProviders } from "@/server/llm/providers";
import { listActions, listTriggers, loadRegistry } from "./registry";
import type { FieldSpec, Localized } from "./types";

/**
 * Serializable description of triggers/actions + reference data for the workflow editor (client component)
 * and for MCP `list_triggers` / `list_actions`.
 */
export type CatalogTrigger = { type: string; labels: { name: Localized; description: Localized }; doc: string; fields: FieldSpec[]; payloadDoc: Record<string, string>; samplePayload: Record<string, unknown> };
export type CatalogAction = { type: string; labels: { name: Localized; description: Localized }; doc: string; fields: FieldSpec[]; outputDoc: Record<string, string> };
export type EditorCatalog = {
  triggers: CatalogTrigger[];
  actions: CatalogAction[];
  areas: { id: string; name: string; slug: string }[];
  providers: { id: string; name: string; kind: string; isDefault: boolean; defaultModel: string | null; models: { id: string; name?: string }[] }[];
  members: { id: string; name: string }[];
};

export async function getEditorCatalog(): Promise<EditorCatalog> {
  await loadRegistry();
  const [areas, providers, members] = await Promise.all([
    listAreas(),
    listProviders(),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.status, "active")).orderBy(asc(users.name)),
  ]);
  return {
    triggers: listTriggers().map((t) => ({ type: t.type, labels: t.labels, doc: t.doc, fields: t.fields, payloadDoc: t.payloadDoc, samplePayload: t.samplePayload })),
    actions: listActions().map((a) => ({ type: a.type, labels: a.labels, doc: a.doc, fields: a.fields, outputDoc: a.outputDoc })),
    areas: areas.map((a) => ({ id: a.id, name: a.name, slug: a.slug })),
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      isDefault: p.isDefault,
      defaultModel: p.defaultModel,
      models: p.availableModels.filter((m) => p.enabledModels.includes(m.id)).map((m) => ({ id: m.id, name: m.name })),
    })),
    members,
  };
}
