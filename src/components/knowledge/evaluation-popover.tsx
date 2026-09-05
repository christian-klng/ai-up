"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { AlertTriangle, Check, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { reevaluateEntryAction } from "@/server/actions/structured-content";
import { useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type EvaluationRowDto = {
  key: string;
  title: string;
  status: "pass" | "fail" | "error";
  reason: string | null;
  checkedAt: string;
};

const STATUS_ICON = { pass: Check, fail: X, error: AlertTriangle } as const;
const STATUS_CLASS = { pass: "text-emerald-600 dark:text-emerald-400", fail: "text-destructive", error: "text-amber-600 dark:text-amber-500" } as const;

/**
 * Verdicts of the template criteria for this entry. Hovering a row shows the model's reason;
 * tapping keeps it open (touch has no hover).
 */
export function EvaluationPopover({
  contentId,
  rows,
  pending,
  criteriaCount,
  canRecheck,
}: {
  contentId: string;
  rows: EvaluationRowDto[];
  /** verdicts for the current version are not in yet */
  pending: boolean;
  criteriaCount: number;
  canRecheck: boolean;
}) {
  const t = useTranslations("knowledge.evaluation");
  const format = useFormatter();
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, start] = useTransition();

  useRealtimeEvent("content.evaluation.updated", (payload) => {
    if (payload.contentId === contentId) router.refresh();
  });

  const failed = rows.filter((r) => r.status === "fail").length;
  const errored = rows.filter((r) => r.status === "error").length;
  const passed = rows.filter((r) => r.status === "pass").length;
  const tone = pending ? "text-muted-foreground" : failed > 0 ? "text-destructive" : errored > 0 ? "text-amber-600 dark:text-amber-500" : "text-emerald-600 dark:text-emerald-400";

  const recheck = () =>
    start(async () => {
      await reevaluateEntryAction(contentId);
      router.refresh();
    });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn("gap-1.5", tone)} aria-label={t("ariaLabel")}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          <span className="tabular-nums">{pending ? t("running") : `${passed}/${rows.length}`}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="px-1 pb-2">
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="text-xs text-muted-foreground">{pending ? t("runningHint", { count: criteriaCount }) : t("hint")}</p>
        </div>

        <ul className="grid gap-0.5">
          {rows.map((row) => {
            const Icon = STATUS_ICON[row.status];
            const open = expanded === row.key;
            return (
              <li key={row.key}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : row.key)}
                      aria-expanded={open}
                      className="flex w-full items-start gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <Icon className={cn("mt-0.5 size-4 shrink-0", STATUS_CLASS[row.status])} />
                      <span className="grid gap-0.5">
                        <span className="font-medium">{row.title}</span>
                        {open && <span className="text-xs text-muted-foreground">{row.reason || t("noReason")}</span>}
                      </span>
                    </button>
                  </TooltipTrigger>
                  {!open && row.reason && (
                    <TooltipContent side="left" className="max-w-64">
                      {row.reason}
                    </TooltipContent>
                  )}
                </Tooltip>
              </li>
            );
          })}
        </ul>

        {rows.length > 0 && (
          <p className="px-1 pt-2 text-[11px] text-muted-foreground">{t("checkedAt", { date: format.dateTime(new Date(rows[0].checkedAt), { dateStyle: "short", timeStyle: "short" }) })}</p>
        )}
        {canRecheck && (
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" disabled={busy} onClick={recheck}>
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> {t("recheck")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
