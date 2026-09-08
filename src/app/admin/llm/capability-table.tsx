import { getFormatter, getTranslations } from "next-intl/server";
import { AlertTriangle, Check, Minus } from "lucide-react";
import { getCapabilityMap, listProviders } from "@/server/llm/providers";
import { statedReasoningLevels, statedToolSupport } from "@/server/llm/capabilities";
import { Badge } from "@/components/ui/badge";
import type { LlmModelInfo, ReasoningLevel } from "@/server/db/schema";

/**
 * What the app knows about each enabled model – read-only. Maintained over MCP
 * (see docs/modell-faehigkeiten.md); this view exists so a guess is recognisable as one.
 */
export async function CapabilityTable() {
  const [t, format, providers, caps] = await Promise.all([getTranslations("admin.llm"), getFormatter(), listProviders(), getCapabilityMap()]);

  // Capabilities are keyed by model id alone, so the same model from two providers is one row.
  const models = new Map<string, { info: LlmModelInfo | undefined; providers: string[] }>();
  for (const p of providers) {
    for (const id of p.enabledModels) {
      const entry = models.get(id) ?? { info: undefined as LlmModelInfo | undefined, providers: [] as string[] };
      entry.info ??= p.availableModels.find((m) => m.id === id);
      entry.providers.push(p.name);
      models.set(id, entry);
    }
  }
  const rows = [...models.entries()].sort(([a], [b]) => a.localeCompare(b));

  const yesNo = (value: boolean | undefined) =>
    value === undefined ? (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <AlertTriangle className="size-3.5" aria-hidden /> {t("capUnknown")}
      </span>
    ) : value ? (
      <span className="inline-flex items-center gap-1">
        <Check className="size-3.5 text-emerald-600" aria-hidden /> {t("capYes")}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="size-3.5" aria-hidden /> {t("capNo")}
      </span>
    );

  const reasoning = (levels: ReasoningLevel[] | undefined) => {
    if (levels === undefined)
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <AlertTriangle className="size-3.5" aria-hidden /> {t("capUnknown")}
        </span>
      );
    if (levels.length === 0) return <span className="text-muted-foreground">{t("capNoReasoning")}</span>;
    return <span className="font-mono text-[11px]">{levels.join(" · ")}</span>;
  };

  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium">{t("capabilitiesTitle")}</h2>
      <p className="mb-3 mt-1 max-w-2xl text-xs text-muted-foreground">{t("capabilitiesIntro")}</p>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("capabilitiesEmpty")}</div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map(([modelId, entry]) => {
            const row = caps.get(modelId);
            const context = row?.contextLength ?? entry.info?.contextLength ?? null;
            return (
              <li key={modelId} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-sm">{modelId}</code>
                    {!row && <Badge variant="secondary">{t("capGuessed")}</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {entry.providers.join(", ")}
                    {row ? ` · ${t("capChecked", { date: format.dateTime(row.checkedAt, { dateStyle: "medium" }) })} · ${row.source}` : ""}
                  </p>
                </div>
                <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs sm:justify-end">
                  <div className="flex items-center gap-1.5">
                    <dt className="text-muted-foreground">{t("capTools")}</dt>
                    <dd>{yesNo(statedToolSupport(row, entry.info))}</dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt className="text-muted-foreground">{t("capReasoning")}</dt>
                    <dd>{reasoning(statedReasoningLevels(row, entry.info))}</dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt className="text-muted-foreground">{t("capContext")}</dt>
                    <dd className="tabular-nums">{context ? format.number(context) : "–"}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
