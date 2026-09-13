"use client";

import { useId, useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, BookOpen, FileText } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { instructionBudget } from "@/lib/agent-instructions";
import { cn } from "@/lib/utils";
import { CollectionTree, type AreaOption, type EntryOption } from "./collection-tree";

export type { AreaOption, EntryOption };

export type ThreadConfigValue = {
  /** assist = read only, curate = may also write (shown as the "Write" permission) */
  mode: "assist" | "curate";
  /** always = every write waits for the member's confirmation; only meaningful with write permission */
  writeApproval: "always" | "never";
  readAreaIds: string[];
  writeAreaIds: string[];
  instructions: EntryOption[];
};

/**
 * Permissions, scope and instructions of a thread – fully controlled, so the same fields serve an
 * existing thread (saved through the panel) and a conversation that does not exist yet (the start
 * screen keeps the value until the first message creates the thread).
 *
 * Scope ("Handlungsradius") is chosen per collection: it decides what the tools may touch, the
 * agent reads there on demand. Instructions are chosen per entry: their markdown sits in the
 * system prompt of every turn (see docs/ki-agenten.md, section 2). Both use the same tree.
 */
export function ThreadConfigFields({ value, onChange, areas }: { value: ThreadConfigValue; onChange: (next: ThreadConfigValue) => void; areas: AreaOption[] }) {
  const t = useTranslations("agents");
  const idPrefix = useId();

  const budget = useMemo(() => instructionBudget(value.instructions.map((i) => i.chars)), [value.instructions]);
  // Writing needs an explicit per-collection grant – "write" without one is a switch that does nothing.
  const writeWithoutTarget = value.mode === "curate" && value.writeAreaIds.length === 0;

  const patch = (p: Partial<ThreadConfigValue>) => onChange({ ...value, ...p });

  const toggleRead = (id: string) => {
    const on = value.readAreaIds.includes(id);
    patch({
      readAreaIds: on ? value.readAreaIds.filter((x) => x !== id) : [...value.readAreaIds, id],
      // Dropping a collection drops its write permission with it.
      writeAreaIds: on ? value.writeAreaIds.filter((x) => x !== id) : value.writeAreaIds,
    });
  };
  const toggleWrite = (id: string) => patch({ writeAreaIds: value.writeAreaIds.includes(id) ? value.writeAreaIds.filter((x) => x !== id) : [...value.writeAreaIds, id] });
  const toggleEntry = (entry: EntryOption) =>
    patch({ instructions: value.instructions.some((i) => i.id === entry.id) ? value.instructions.filter((i) => i.id !== entry.id) : [...value.instructions, entry] });

  return (
    <>
      <section className="grid gap-2">
        <h3 className="text-sm font-medium">{t("rights")}</h3>
        <div className="grid gap-2.5">
          {/* Reading is what every agent does – shown for transparency, not as a choice. */}
          <div className="flex items-start gap-2.5">
            <Checkbox id={`${idPrefix}-read`} checked disabled className="mt-0.5" />
            <div className="grid gap-0.5">
              <Label htmlFor={`${idPrefix}-read`} className="text-sm font-normal">
                {t("rightRead")}
              </Label>
              <p className="text-xs text-muted-foreground">{t("rightReadHint")}</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Checkbox
              id={`${idPrefix}-write`}
              checked={value.mode === "curate"}
              onCheckedChange={(checked) => {
                const write = checked === true;
                // Taking write permission away drops the collections allowed for writing with it.
                patch({ mode: write ? "curate" : "assist", writeAreaIds: write || value.writeAreaIds.length === 0 ? value.writeAreaIds : [] });
              }}
              className="mt-0.5"
            />
            <div className="grid gap-0.5">
              <Label htmlFor={`${idPrefix}-write`} className="text-sm font-normal">
                {t("rightWrite")}
              </Label>
              <p className="text-xs text-muted-foreground">{t("rightWriteHint")}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-2">
        <h3 className="text-sm font-medium">{t("askFirst")}</h3>
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={`${idPrefix}-ask`}
            checked={value.writeApproval === "always"}
            disabled={value.mode !== "curate"}
            onCheckedChange={(checked) => patch({ writeApproval: checked === true ? "always" : "never" })}
            className="mt-0.5"
          />
          <div className="grid gap-0.5">
            <Label htmlFor={`${idPrefix}-ask`} className="text-sm font-normal">
              {t("askFirstLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">{t(value.mode === "curate" ? "askFirstHint" : "askFirstNeedsWrite")}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <BookOpen className="size-4 opacity-70" /> {t("scope")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("scopeHint")} {value.readAreaIds.length === 0 ? t("scopeAllHint") : t("scopeSelectedHint")}
        </p>
        {writeWithoutTarget && (
          <p role="status" className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{t(value.readAreaIds.length === 0 ? "writeNeedsSelection" : "writeNeedsGrant")}</span>
          </p>
        )}
        <CollectionTree mode="scope" areas={areas} readAreaIds={value.readAreaIds} writeAreaIds={value.writeAreaIds} canWrite={value.mode === "curate"} onToggleRead={toggleRead} onToggleWrite={toggleWrite} />
      </section>

      <section className="grid gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <FileText className="size-4 opacity-70" /> {t("instructions")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("instructionsHint")}</p>
        <CollectionTree mode="instructions" areas={areas} selected={value.instructions} onToggleEntry={toggleEntry} />
        {value.instructions.length > 0 && (
          <div className="grid gap-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={budget.percent} aria-valuemin={0} aria-valuemax={100} aria-label={t("instructionBudget")}>
              <div className={cn("h-full rounded-full transition-all", budget.exceeded ? "bg-destructive" : budget.percent >= 80 ? "bg-amber-500" : "bg-primary")} style={{ width: `${budget.percent}%` }} />
            </div>
            <p className={cn("text-[11px] tabular-nums", budget.exceeded ? "text-destructive" : "text-muted-foreground")}>
              {t("instructionBudgetUsed", { used: budget.used, max: budget.max })}
              {budget.exceeded && ` – ${t("instructionBudgetExceeded")}`}
            </p>
          </div>
        )}
      </section>
    </>
  );
}

/** Weekly quota bar – shown wherever the configuration is (percentage only, never amounts). */
export function QuotaBar({ budget }: { budget: { budget: number; percent: number; exceeded: boolean } | null }) {
  const t = useTranslations("agents");
  if (!budget || budget.budget <= 0) return null;
  return (
    <section className="grid gap-1.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">{t("quota")}</h3>
        <span className={cn("text-xs tabular-nums", budget.exceeded ? "text-destructive" : "text-muted-foreground")}>{t("quotaUsed", { percent: budget.percent })}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={budget.percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full transition-all", budget.exceeded ? "bg-destructive" : "bg-primary")} style={{ width: `${budget.percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{budget.exceeded ? t("quotaExceededHint") : t("quotaHint")}</p>
    </section>
  );
}
