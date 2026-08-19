"use client";

import { useFormatter, useTranslations } from "next-intl";
import { formatDuration } from "@/components/workflows/run-status";

export type StatsView = {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  successRate: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  lastRunAt: string | null;
  perDay: { day: string; succeeded: number; failed: number }[];
  tokens: { promptTokens: number; completionTokens: number; cost: number };
  topErrors: { error: string; count: number }[];
};

/** Compact statistics: KPI tiles + a small stacked bar chart of runs per day (inline SVG, no chart lib). */
export function StatsPanel({ stats, compact }: { stats: StatsView; compact?: boolean }) {
  const t = useTranslations("workflows.stats");
  const format = useFormatter();
  const max = Math.max(1, ...stats.perDay.map((d) => d.succeeded + d.failed));
  const W = 420;
  const H = 72;
  const barW = W / stats.perDay.length;

  const tiles = [
    { label: t("runs"), value: String(stats.total) },
    { label: t("successRate"), value: `${stats.successRate} %` },
    { label: t("avgDuration"), value: formatDuration(stats.avgDurationMs) },
    { label: t("p95"), value: formatDuration(stats.p95DurationMs) },
    { label: t("tokens"), value: format.number(stats.tokens.promptTokens + stats.tokens.completionTokens) },
  ];

  return (
    <div className="grid gap-4 rounded-lg border bg-card p-4 lg:grid-cols-[1fr_auto]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((k) => (
          <div key={k.label} className="rounded-md bg-muted/40 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
            <div className="text-lg font-semibold tabular-nums">{k.value}</div>
          </div>
        ))}
      </div>
      <div className="min-w-0">
        <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">{t("perDay", { days: stats.perDay.length })}</div>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[72px] w-full max-w-[420px]" role="img" aria-label={t("perDay", { days: stats.perDay.length })}>
          {stats.perDay.map((d, i) => {
            const total = d.succeeded + d.failed;
            const hOk = (d.succeeded / max) * (H - 4);
            const hErr = (d.failed / max) * (H - 4);
            const x = i * barW + 2;
            return (
              <g key={d.day}>
                <title>{`${d.day}: ${d.succeeded} ok / ${d.failed} failed`}</title>
                <rect x={x} y={H - hOk} width={barW - 4} height={hOk} rx={2} className="fill-emerald-500/70" />
                <rect x={x} y={H - hOk - hErr} width={barW - 4} height={hErr} rx={2} className="fill-red-500/70" />
                {total === 0 && <rect x={x} y={H - 2} width={barW - 4} height={2} className="fill-muted-foreground/20" />}
              </g>
            );
          })}
        </svg>
      </div>
      {!compact && stats.topErrors.length > 0 && (
        <div className="lg:col-span-2">
          <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">{t("topErrors")}</div>
          <ul className="grid gap-0.5 text-xs">
            {stats.topErrors.map((e) => (
              <li key={e.error} className="flex gap-2">
                <span className="w-8 shrink-0 tabular-nums text-muted-foreground">{e.count}×</span>
                <span className="truncate font-mono">{e.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
