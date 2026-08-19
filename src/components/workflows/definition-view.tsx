import { ArrowDown, Zap } from "lucide-react";
import type { WorkflowDefinition } from "@/server/db/schema";
import type { EditorCatalog } from "@/server/workflows/catalog";

type Loc = "de" | "en";

/**
 * Human-readable rendering of a workflow definition: trigger, then steps as a vertical chain.
 * `showConfig` reveals the config values (prompts, urls…) – used for admins and for the members' transparency view.
 */
export function WorkflowDefinitionView({ definition, catalog, locale, showConfig }: { definition: WorkflowDefinition; catalog: EditorCatalog; locale: Loc; showConfig?: boolean }) {
  const trigger = catalog.triggers.find((x) => x.type === definition.trigger.type);
  const areaName = (id: unknown) => catalog.areas.find((a) => a.id === id)?.name ?? String(id);
  const providerName = (id: unknown) => (id === "default" || !id ? "default" : (catalog.providers.find((p) => p.id === id)?.name ?? String(id)));

  const renderValue = (key: string, v: unknown): string => {
    if (v === undefined || v === null || v === "") return "–";
    if (key === "areaId") return areaName(v);
    if (key === "areaIds") return Array.isArray(v) && v.length ? v.map(areaName).join(", ") : locale === "de" ? "alle" : "all";
    if (key === "providerId") return providerName(v);
    if (key === "audience" && typeof v === "object") {
      const a = v as { type?: string; userIds?: string[] };
      return a.type === "users" ? `${a.type} (${(a.userIds ?? []).map((id) => catalog.members.find((m) => m.id === id)?.name ?? id).join(", ")})` : (a.type ?? "–");
    }
    if (Array.isArray(v)) return v.length ? v.join(", ") : locale === "de" ? "alle" : "all";
    if (typeof v === "object") return JSON.stringify(v, null, 2);
    return String(v);
  };

  const configRows = (fields: { key: string; label: { de: string; en: string }; type: string }[], config: Record<string, unknown>) => {
    const keys = fields.map((f) => f.key);
    if (fields.some((f) => f.type === "llm-model")) keys.push("model");
    return keys
      .filter((k) => config[k] !== undefined && config[k] !== "" && !(Array.isArray(config[k]) && (config[k] as unknown[]).length === 0 && k !== "areaIds" && k !== "contentTypes"))
      .map((k) => {
        const f = fields.find((x) => x.key === k);
        return { key: k, label: f ? f.label[locale] : k, value: renderValue(k, config[k]), long: typeof config[k] === "string" && (config[k] as string).length > 80 };
      });
  };

  return (
    <div className="grid gap-2">
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Zap className="size-3.5" /> {locale === "de" ? "Auslöser" : "Trigger"}
        </div>
        <div className="mt-1 font-medium">{trigger?.labels.name[locale] ?? definition.trigger.type}</div>
        {trigger && <p className="text-sm text-muted-foreground">{trigger.labels.description[locale]}</p>}
        {showConfig && trigger && (
          <dl className="mt-2 grid gap-1 text-sm">
            {configRows(trigger.fields, definition.trigger.config).map((r) => (
              <div key={r.key} className="grid grid-cols-[140px_1fr] gap-2">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className="whitespace-pre-wrap break-words font-mono text-xs">{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {definition.steps.map((s, i) => {
        const def = catalog.actions.find((a) => a.type === s.action);
        return (
          <div key={`${s.id}-${i}`} className="grid gap-2">
            <ArrowDown className="mx-auto size-4 text-muted-foreground/60" />
            <div className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
                <span className="font-medium">{s.name || def?.labels.name[locale] || s.action}</span>
                <span className="font-mono text-xs text-muted-foreground">{s.action}</span>
                <span className="font-mono text-xs text-muted-foreground">· steps.{s.id}</span>
                {s.condition && <span className="ml-auto font-mono text-[11px] text-muted-foreground">if {s.condition}</span>}
              </div>
              {def && <p className="mt-1 text-sm text-muted-foreground">{def.labels.description[locale]}</p>}
              {showConfig && def && (
                <dl className="mt-2 grid gap-1 text-sm">
                  {configRows(def.fields, s.config).map((r) => (
                    <div key={r.key} className="grid grid-cols-[140px_1fr] gap-2">
                      <dt className="text-muted-foreground">{r.label}</dt>
                      <dd className={r.long ? "max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-mono text-xs" : "whitespace-pre-wrap break-words font-mono text-xs"}>{r.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
