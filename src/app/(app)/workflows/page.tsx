import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { listWorkflows } from "@/server/workflows/service";
import { loadRegistry } from "@/server/workflows/registry";
import { describeStep, describeTrigger } from "@/server/workflows/definitions";
import { PageHeader } from "@/components/common/page-header";
import { RunStatusBadge, WorkflowStatusDot } from "@/components/workflows/run-status";

/** Transparency view for members: which automations exist, what they do, when they last ran. */
export default async function WorkflowsPage() {
  const user = await requireUser();
  await loadRegistry();
  const [t, format, locale, items] = await Promise.all([getTranslations("workflows"), getFormatter(), getLocale(), listWorkflows()]);
  const loc = locale === "en" ? "en" : "de";
  const visible = items.filter((w) => w.status !== "draft" || user.role === "admin");

  return (
    <div className="max-w-4xl">
      <PageHeader title={t("title")} description={t("intro")} />
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3">
          {visible.map((w) => (
            <li key={w.id}>
              <Link href={`/workflows/${w.id}`} className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/40">
                <div className="flex flex-wrap items-center gap-2">
                  <WorkflowStatusDot status={w.status} />
                  <span className="font-medium">{w.name}</span>
                  <span className="text-xs text-muted-foreground">{t(`status.${w.status}`)}</span>
                  {w.lastRunStatus && <RunStatusBadge status={w.lastRunStatus} label={t(`runStatus.${w.lastRunStatus}`)} className="ml-auto" />}
                </div>
                {w.description && <p className="mt-1 text-sm text-muted-foreground">{w.description}</p>}
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("chain", { trigger: describeTrigger(w.trigger, loc), steps: w.steps.map((s) => describeStep(s, loc)).join(" → ") })}
                  {w.lastRunAt && ` · ${t("lastRun", { date: format.relativeTime(w.lastRunAt) })}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
