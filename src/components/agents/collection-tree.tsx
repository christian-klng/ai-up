"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, FileText, Loader2, Pencil, Search } from "lucide-react";
import { listCollectionEntriesAction, searchEntriesAction } from "@/server/actions/agents";
import { AreaIcon } from "@/components/knowledge/area-icon";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TREE_ENTRY_LIMIT } from "@/lib/agents";
import { cn } from "@/lib/utils";

export type AreaOption = { id: string; name: string; icon: string; purpose: string; entryCount: number };
/** `chars` = what the entry costs in the instruction budget (heading + body as rendered into the prompt). */
export type EntryOption = { id: string; title: string; areaId: string; areaName: string; chars: number };

/**
 * Scope: collections are the unit – a checkbox grants reading, "Edit" adds writing. Entries are
 * listed underneath so people can see what a collection holds, but are not selectable (yet).
 */
type ScopeProps = {
  mode: "scope";
  readAreaIds: string[];
  writeAreaIds: string[];
  /** false hides the "Edit" toggle (thread has no write permission) */
  canWrite: boolean;
  onToggleRead: (areaId: string) => void;
  onToggleWrite: (areaId: string) => void;
};

/** Instructions: entries are the unit – collections only group them. Comes with a search. */
type InstructionProps = {
  mode: "instructions";
  selected: EntryOption[];
  onToggleEntry: (entry: EntryOption) => void;
};

type Props = { areas: AreaOption[] } & (ScopeProps | InstructionProps);

/**
 * One tree of collections (folders) and entries (files) for both sections of the thread
 * configuration. Entries load when a folder is unfolded; the search (instructions only) filters
 * the tree instead of opening a separate result list.
 */
export function CollectionTree(props: Props) {
  const { areas } = props;
  const t = useTranslations("agents");
  const idPrefix = useId();
  const selectedIds = useMemo(() => new Set(props.mode === "instructions" ? props.selected.map((e) => e.id) : []), [props]);

  // Folders holding a chosen instruction start open – otherwise the choice would be invisible.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(props.mode === "instructions" ? props.selected.map((e) => e.areaId) : []));
  const [entries, setEntries] = useState<Record<string, EntryOption[]>>({});
  // Loading is derived (folder open, entries not there yet); the ref only stops a second request.
  const inFlight = useRef(new Set<string>());

  const load = useCallback(async (areaId: string) => {
    if (inFlight.current.has(areaId)) return;
    inFlight.current.add(areaId);
    try {
      const rows = await listCollectionEntriesAction(areaId);
      setEntries((prev) => (prev[areaId] ? prev : { ...prev, [areaId]: [...rows].sort((a, b) => a.title.localeCompare(b.title)) }));
    } finally {
      inFlight.current.delete(areaId);
    }
  }, []);

  // Folders that are open from the start need their entries as well.
  useEffect(() => {
    for (const id of expanded) if (!entries[id]) void load(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: later unfolds load on click
  }, []);

  const toggleExpanded = (areaId: string) => {
    const opening = !expanded.has(areaId);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(areaId)) next.delete(areaId);
      else next.add(areaId);
      return next;
    });
    if (opening && !entries[areaId]) void load(areaId);
  };

  // Search (instructions only): the term filters the tree, matching folders open automatically.
  // Results remember the term they answer, so a stale answer is simply ignored.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ term: string; rows: EntryOption[] } | null>(null);
  const term = query.trim();
  const active = props.mode === "instructions" && term.length >= 2;
  const searching = active && results?.term !== term;

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(async () => {
      const rows = await searchEntriesAction(term);
      setResults({ term, rows });
    }, 250);
    return () => clearTimeout(timer);
  }, [active, term]);

  const matches = useMemo(() => {
    if (!active || !results || results.term !== term) return null;
    const byArea = new Map<string, EntryOption[]>();
    for (const r of results.rows) byArea.set(r.areaId, [...(byArea.get(r.areaId) ?? []), r]);
    return byArea;
  }, [active, results, term]);

  const lower = term.toLowerCase();
  const visibleAreas = matches ? areas.filter((a) => matches.has(a.id) || a.name.toLowerCase().includes(lower)) : areas;

  return (
    <div className="grid gap-1.5">
      {props.mode === "instructions" && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchEntries")} className="pl-8" aria-label={t("searchEntries")} />
          {searching && <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
        </div>
      )}
      {term.length === 1 && props.mode === "instructions" && <p className="text-[11px] text-muted-foreground">{t("searchMinChars")}</p>}
      {matches && visibleAreas.length === 0 && !searching && <p className="text-[11px] text-muted-foreground">{t("searchNoResults")}</p>}
      {areas.length === 0 && <p className="text-xs text-muted-foreground">{t("noCollections")}</p>}

      <ul className="grid gap-1">
        {visibleAreas.map((area) => {
          const open = matches ? matches.has(area.id) : expanded.has(area.id);
          const rows = matches ? (matches.get(area.id) ?? []) : (entries[area.id] ?? null);
          const isLoading = !matches && open && rows === null;
          const chosenHere = props.mode === "instructions" ? props.selected.filter((e) => e.areaId === area.id).length : 0;
          const read = props.mode === "scope" && props.readAreaIds.includes(area.id);
          const writable = props.mode === "scope" && props.writeAreaIds.includes(area.id);
          const canUnfold = area.entryCount > 0 && !matches;

          const chevron = (
            <button
              type="button"
              onClick={() => toggleExpanded(area.id)}
              disabled={!canUnfold}
              aria-expanded={open}
              aria-label={open ? t("collapse") : t("expand")}
              className={cn("flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30", !canUnfold && "invisible")}
            >
              {isLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />}
            </button>
          );

          const label = (
            <>
              <AreaIcon icon={area.icon} className={cn("size-4 shrink-0", read ? "text-primary" : "opacity-60")} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{area.name}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {chosenHere > 0 ? t("chosenCount", { count: chosenHere }) : t("entryCount", { count: area.entryCount })}
              </span>
            </>
          );

          return (
            <li key={area.id}>
              <div className={cn("flex items-center gap-1 rounded-md border pr-1 transition-colors", read ? "border-primary/40 bg-primary/5" : "border-transparent")}>
                {chevron}
                {props.mode === "scope" ? (
                  <>
                    <Checkbox id={`${idPrefix}-${area.id}`} checked={read} onCheckedChange={() => props.onToggleRead(area.id)} aria-label={t("readAccess")} />
                    <label htmlFor={`${idPrefix}-${area.id}`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pl-1 text-sm">
                      {label}
                    </label>
                    {props.canWrite && read && (
                      <button
                        type="button"
                        onClick={() => props.onToggleWrite(area.id)}
                        aria-pressed={writable}
                        title={t("mayEdit")}
                        className={cn("flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] transition-colors", writable ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent")}
                      >
                        <Pencil className="size-3" aria-hidden /> {t("mayEdit")}
                      </button>
                    )}
                  </>
                ) : (
                  <button type="button" onClick={() => canUnfold && toggleExpanded(area.id)} disabled={!canUnfold} className="flex min-w-0 flex-1 items-center gap-2 rounded py-1.5 pl-1 text-left text-sm hover:bg-accent/40 disabled:cursor-default disabled:hover:bg-transparent">
                    {label}
                  </button>
                )}
              </div>

              {open && rows && (
                <ul className="ml-3 grid gap-0.5 border-l py-0.5 pl-3">
                  {rows.length === 0 && <li className="px-2 py-1 text-[11px] text-muted-foreground">{t("noEntries")}</li>}
                  {rows.map((entry) =>
                    props.mode === "instructions" ? (
                      <li key={entry.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent/40">
                        <Checkbox id={`${idPrefix}-e-${entry.id}`} checked={selectedIds.has(entry.id)} onCheckedChange={() => props.onToggleEntry(entry)} />
                        <label htmlFor={`${idPrefix}-e-${entry.id}`} className="min-w-0 flex-1 cursor-pointer">
                          <span className="block truncate text-sm">{entry.title}</span>
                          <span className="block text-[11px] tabular-nums text-muted-foreground">{t("chars", { count: entry.chars })}</span>
                        </label>
                      </li>
                    ) : (
                      <li key={entry.id} className="flex items-center gap-1.5 px-1.5 py-0.5 text-xs text-muted-foreground">
                        <FileText className="size-3 shrink-0 opacity-70" aria-hidden />
                        <span className="truncate">{entry.title}</span>
                      </li>
                    ),
                  )}
                  {!matches && rows.length >= TREE_ENTRY_LIMIT && <li className="px-2 py-1 text-[11px] text-muted-foreground">{t("moreEntries", { count: TREE_ENTRY_LIMIT })}</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
