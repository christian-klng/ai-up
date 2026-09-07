"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, FileText, Loader2, Pencil, Search, X } from "lucide-react";
import { searchEntriesAction } from "@/server/actions/agents";
import { AreaIcon } from "@/components/knowledge/area-icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type AreaOption = { id: string; name: string; icon: string; purpose: string };
export type EntryOption = { id: string; title: string; areaId: string; areaName: string };

export type ThreadConfigValue = {
  mode: "assist" | "curate";
  readAreaIds: string[];
  writeAreaIds: string[];
  instructions: EntryOption[];
};

/**
 * What the agent may read and which entries steer it – fully controlled, so the same fields serve
 * an existing thread (saved through the panel) and a conversation that does not exist yet
 * (the start screen keeps the value until the first message creates the thread).
 *
 * Access is chosen per collection, instructions per entry: a collection quickly holds fifty
 * entries of which exactly one is the instruction (see docs/ki-agenten.md, section 2).
 */
export function ThreadConfigFields({ value, onChange, areas }: { value: ThreadConfigValue; onChange: (next: ThreadConfigValue) => void; areas: AreaOption[] }) {
  const t = useTranslations("agents");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntryOption[]>([]);
  const [searching, setSearching] = useState(false);

  const term = query.trim();
  // Results are only rendered while the term is long enough, so nothing has to be cleared here.
  const showResults = term.length >= 2;

  useEffect(() => {
    if (term.length < 2) return;
    // Debounced so typing does not fire a query per keystroke.
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchEntriesAction(term));
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [term]);

  const chosen = useMemo(() => new Set(value.instructions.map((i) => i.id)), [value.instructions]);

  const patch = (p: Partial<ThreadConfigValue>) => onChange({ ...value, ...p });

  const toggleArea = (id: string) => {
    const on = value.readAreaIds.includes(id);
    patch({
      readAreaIds: on ? value.readAreaIds.filter((x) => x !== id) : [...value.readAreaIds, id],
      // Dropping a collection drops its write permission with it.
      writeAreaIds: on ? value.writeAreaIds.filter((x) => x !== id) : value.writeAreaIds,
    });
  };
  const toggleWrite = (id: string) => patch({ writeAreaIds: value.writeAreaIds.includes(id) ? value.writeAreaIds.filter((x) => x !== id) : [...value.writeAreaIds, id] });
  const addInstruction = (entry: EntryOption) => {
    if (!value.instructions.some((i) => i.id === entry.id)) patch({ instructions: [...value.instructions, entry] });
    setQuery("");
  };

  return (
    <>
      <section className="grid gap-2">
        <h3 className="text-sm font-medium">{t("mode")}</h3>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          {(["assist", "curate"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={value.mode === m}
              // Leaving curate mode drops the write permissions – nothing may be written in assist.
              onClick={() => m !== value.mode && patch({ mode: m, writeAreaIds: m === "curate" ? value.writeAreaIds : [] })}
              className={cn("rounded px-2 py-1.5 text-xs font-medium transition-colors", value.mode === m ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {t(m === "assist" ? "modeAssist" : "modeCurate")}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(value.mode === "assist" ? "modeAssistHint" : "modeCurateHint")}</p>
      </section>

      <section className="grid gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <BookOpen className="size-4 opacity-70" /> {t("collections")}
        </h3>
        <p className="text-xs text-muted-foreground">{value.readAreaIds.length === 0 ? t("collectionsAllHint") : t("collectionsHint")}</p>
        <ul className="grid gap-1">
          {areas.map((a) => {
            const on = value.readAreaIds.includes(a.id);
            const writable = value.writeAreaIds.includes(a.id);
            return (
              <li key={a.id} className={cn("flex items-center gap-1 rounded-md border transition-colors", on ? "border-primary/40 bg-primary/5" : "border-transparent")}>
                <button type="button" onClick={() => toggleArea(a.id)} aria-pressed={on} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent/40">
                  <AreaIcon icon={a.icon} className={cn("size-4 shrink-0", on ? "text-primary" : "opacity-60")} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                </button>
                {value.mode === "curate" && on && (
                  <button
                    type="button"
                    onClick={() => toggleWrite(a.id)}
                    aria-pressed={writable}
                    title={t("mayEdit")}
                    className={cn("mr-1 flex items-center gap-1 rounded px-1.5 py-1 text-[11px] transition-colors", writable ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent")}
                  >
                    <Pencil className="size-3" aria-hidden /> {t("mayEdit")}
                  </button>
                )}
              </li>
            );
          })}
          {areas.length === 0 && <li className="text-xs text-muted-foreground">{t("noCollections")}</li>}
        </ul>
      </section>

      <section className="grid gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <FileText className="size-4 opacity-70" /> {t("instructions")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("instructionsHint")}</p>
        {value.instructions.length > 0 && (
          <ul className="grid gap-1">
            {value.instructions.map((i) => (
              <li key={i.id} className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{i.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{i.areaName}</span>
                </span>
                <button
                  type="button"
                  onClick={() => patch({ instructions: value.instructions.filter((x) => x.id !== i.id) })}
                  aria-label={t("removeInstruction")}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchEntries")} className="pl-8" />
          {searching && <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
        </div>
        {showResults && results.length > 0 && (
          <ul className="grid max-h-56 gap-0.5 overflow-y-auto rounded-md border p-1">
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" disabled={chosen.has(r.id)} onClick={() => addInstruction(r)} className="flex w-full flex-col rounded px-2 py-1.5 text-left text-sm hover:bg-accent/60 disabled:opacity-40">
                  <span className="truncate">{r.title}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{r.areaName}</span>
                </button>
              </li>
            ))}
          </ul>
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
