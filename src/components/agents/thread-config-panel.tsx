"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BookOpen, FileText, Loader2, Pencil, Search, X } from "lucide-react";
import { saveThreadConfigAction, searchEntriesAction, setThreadModeAction } from "@/server/actions/agents";
import { AreaIcon } from "@/components/knowledge/area-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type AreaOption = { id: string; name: string; icon: string; purpose: string };
export type EntryOption = { id: string; title: string; areaId: string; areaName: string };

/**
 * Right-hand panel: what the agent may read and which entries steer it.
 * Access is chosen per collection, instructions per entry – a collection quickly holds fifty
 * entries of which exactly one is the instruction (see docs/ki-agenten.md, section 2).
 */
export function ThreadConfigPanel({
  threadId,
  areas,
  initialReadAreaIds,
  initialWriteAreaIds,
  initialInstructions,
  mode,
  onModeChange,
}: {
  threadId: string;
  areas: AreaOption[];
  initialReadAreaIds: string[];
  initialWriteAreaIds: string[];
  initialInstructions: EntryOption[];
  mode: "assist" | "curate";
  onModeChange: (mode: "assist" | "curate") => void;
}) {
  const t = useTranslations("agents");
  const tc = useTranslations("common");
  const [readIds, setReadIds] = useState<string[]>(initialReadAreaIds);
  const [writeIds, setWriteIds] = useState<string[]>(initialWriteAreaIds);
  const [instructions, setInstructions] = useState<EntryOption[]>(initialInstructions);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntryOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, startSave] = useTransition();
  const [dirty, setDirty] = useState(false);

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

  const chosen = useMemo(() => new Set(instructions.map((i) => i.id)), [instructions]);

  const toggleArea = (id: string) => {
    setReadIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    // Dropping a collection drops its write permission with it.
    setWriteIds((prev) => prev.filter((x) => x !== id || !readIds.includes(id)));
    setDirty(true);
  };
  const toggleWrite = (id: string) => {
    setWriteIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setDirty(true);
  };
  const addInstruction = (entry: EntryOption) => {
    setInstructions((prev) => (prev.some((i) => i.id === entry.id) ? prev : [...prev, entry]));
    setQuery("");
    setDirty(true);
  };
  const removeInstruction = (id: string) => {
    setInstructions((prev) => prev.filter((i) => i.id !== id));
    setDirty(true);
  };

  const save = () =>
    startSave(async () => {
      const res = await saveThreadConfigAction(threadId, {
        readAreaIds: readIds,
        // Writing is a curate-mode capability; in assist mode nothing may be written.
        writeAreaIds: mode === "curate" ? writeIds.filter((id) => readIds.includes(id)) : [],
        instructionContentIds: instructions.map((i) => i.id),
      });
      if (res.ok) {
        setDirty(false);
        toast.success(tc("saved"));
      } else toast.error(tc("unexpectedError"));
    });

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <section className="grid gap-2">
        <h3 className="text-sm font-medium">{t("mode")}</h3>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          {(["assist", "curate"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                if (m === mode) return;
                onModeChange(m);
                void setThreadModeAction(threadId, m, "always");
              }}
              className={cn("rounded px-2 py-1.5 text-xs font-medium transition-colors", mode === m ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {t(m === "assist" ? "modeAssist" : "modeCurate")}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(mode === "assist" ? "modeAssistHint" : "modeCurateHint")}</p>
      </section>

      <section className="grid gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <BookOpen className="size-4 opacity-70" /> {t("collections")}
        </h3>
        <p className="text-xs text-muted-foreground">{readIds.length === 0 ? t("collectionsAllHint") : t("collectionsHint")}</p>
        <ul className="grid gap-1">
          {areas.map((a) => {
            const on = readIds.includes(a.id);
            const writable = writeIds.includes(a.id);
            return (
              <li key={a.id} className={cn("flex items-center gap-1 rounded-md border transition-colors", on ? "border-primary/40 bg-primary/5" : "border-transparent")}>
                <button type="button" onClick={() => toggleArea(a.id)} aria-pressed={on} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent/40">
                  <AreaIcon icon={a.icon} className={cn("size-4 shrink-0", on ? "text-primary" : "opacity-60")} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                </button>
                {mode === "curate" && on && (
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
        {instructions.length > 0 && (
          <ul className="grid gap-1">
            {instructions.map((i) => (
              <li key={i.id} className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{i.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{i.areaName}</span>
                </span>
                <button type="button" onClick={() => removeInstruction(i.id)} aria-label={t("removeInstruction")} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
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
                <button
                  type="button"
                  disabled={chosen.has(r.id)}
                  onClick={() => addInstruction(r)}
                  className="flex w-full flex-col rounded px-2 py-1.5 text-left text-sm hover:bg-accent/60 disabled:opacity-40"
                >
                  <span className="truncate">{r.title}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{r.areaName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-auto pt-2">
        <Button type="button" size="sm" className="w-full" disabled={!dirty || saving} onClick={save}>
          {saving && <Loader2 className="size-4 animate-spin" />} {tc("save")}
        </Button>
      </div>
    </div>
  );
}
