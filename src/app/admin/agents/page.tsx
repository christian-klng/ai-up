import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { ensureSystemAgent, DEFAULT_AGENT_SYSTEM_PROMPT } from "@/server/domain/agents";
import { listProviderOptions } from "@/server/llm/providers";
import { listWeeklyUsage } from "@/server/agents/usage";
import { getAppSettings } from "@/server/domain/settings";
import { getFormatter } from "next-intl/server";
import { PageHeader } from "@/components/common/page-header";
import { cn } from "@/lib/utils";
import { AgentForm } from "./agent-form";
import { QuotaForm } from "./quota-form";

export default async function AdminAgentsPage() {
  await requireAdmin();
  const [t, agent, providers, settings, usage, format] = await Promise.all([
    getTranslations("admin.agents"),
    ensureSystemAgent(),
    listProviderOptions(),
    getAppSettings(),
    listWeeklyUsage(),
    getFormatter(),
  ]);

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("intro")} />
      <AgentForm
        agent={{
          id: agent.id,
          name: agent.name,
          description: agent.description,
          avatarMediaId: agent.avatarMediaId,
          providerId: agent.providerId ?? "default",
          model: agent.model ?? "default",
          systemPrompt: agent.systemPrompt,
          reasoningEffort: agent.reasoningEffort ?? "none",
          maxSteps: agent.maxSteps,
          maxTokensPerTurn: agent.maxTokensPerTurn,
        }}
        providers={providers}
        defaultSystemPrompt={DEFAULT_AGENT_SYSTEM_PROMPT}
      />

      <div className="mt-6 grid gap-6">
        <QuotaForm budget={settings.agentWeeklyTokenBudget} outputWeight={settings.agentOutputTokenWeight} />

        <section>
          <h2 className="mb-1 text-sm font-medium">{t("usageTitle")}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("usageSince", { date: format.dateTime(usage.since, { dateStyle: "medium" }) })}</p>
          {usage.rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("usageEmpty")}</div>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {usage.rows.map((r) => (
                <li key={r.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t("usageBreakdown", { input: format.number(r.promptTokens), output: format.number(r.completionTokens) })}
                      {r.cost > 0 ? ` · ${format.number(r.cost, { style: "currency", currency: "USD", maximumFractionDigits: 2 })}` : ""}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums">{format.number(r.weighted)}</span>
                  {usage.budget > 0 && (
                    <span className={cn("w-12 text-right text-xs tabular-nums", r.weighted >= usage.budget ? "text-destructive" : "text-muted-foreground")}>
                      {Math.min(999, Math.round((r.weighted / usage.budget) * 100))}%
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
