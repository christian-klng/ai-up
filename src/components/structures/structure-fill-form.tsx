"use client";

import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import type { AnswerIssue } from "@/lib/structures/validate";
import { validateStructureAnswers } from "@/lib/structures/validate";
import type { ProcessGraph, QaPair, StructureAnswers, StructureDefinition, StructureElement } from "@/lib/structures/types";
import { visibleElements } from "@/lib/structures/visibility";
import { saveStructuredEntryAction } from "@/server/actions/structured-content";
import { Markdown } from "@/components/content/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ProcessGraphEditor = dynamic(() => import("./process-graph-editor").then((m) => m.ProcessGraphEditor), { ssr: false });

export type StructureFillFormProps = {
  def: StructureDefinition;
  mode: "create" | "edit" | "preview";
  areaId?: string;
  areaSlug?: string;
  contentId?: string;
  initialTitle?: string;
  initialAnswers?: StructureAnswers;
};

export function StructureFillForm({ def, mode, areaId, contentId, initialTitle, initialAnswers }: StructureFillFormProps) {
  const t = useTranslations("knowledge.structured");
  const te = useTranslations("knowledge.editor");
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle ?? "");
  const [answers, setAnswers] = useState<StructureAnswers>(initialAnswers ?? {});
  const [changeNote, setChangeNote] = useState("");
  const [issues, setIssues] = useState<AnswerIssue[]>([]);
  const [titleMissing, setTitleMissing] = useState(false);
  const [pending, start] = useTransition();

  const visible = useMemo(() => visibleElements(def, answers), [def, answers]);
  const issueFor = (key: string) => issues.find((i) => i.key === key);

  const setValue = (key: string, value: StructureAnswers[string]) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setIssues((prev) => prev.filter((i) => i.key !== key));
  };

  const submit = () => {
    const missingTitle = !title.trim();
    setTitleMissing(missingTitle);
    // Untouched process elements submit their seed graph as the answer.
    const effective: StructureAnswers = { ...answers };
    for (const el of visibleElements(def, effective)) {
      if (el.type === "process" && effective[el.key] === undefined) effective[el.key] = structuredClone(el.seed);
    }
    const res = validateStructureAnswers(def, effective);
    if (!res.ok) {
      setIssues(res.issues);
      toast.error(t("missingRequired"));
      return;
    }
    if (missingTitle) {
      toast.error(t("missingRequired"));
      return;
    }
    setIssues([]);
    start(async () => {
      const result = await saveStructuredEntryAction({
        areaId: areaId!,
        contentId,
        title: title.trim(),
        answers: res.answers,
        changeNote: changeNote.trim() || undefined,
      });
      if (result.ok) {
        toast.success(t("saved"));
        router.push(`/knowledge/${result.areaSlug}/${result.contentId}`);
        router.refresh();
      } else {
        setIssues(result.issues);
        toast.error(t("missingRequired"));
      }
    });
  };

  return (
    <form
      className="grid grid-cols-1 gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (mode !== "preview") submit();
      }}
    >
      {def.intro && (
        <div className="text-sm text-muted-foreground">
          <Markdown>{def.intro}</Markdown>
        </div>
      )}
      {mode !== "preview" && (
        <div className="grid grid-cols-1 gap-1.5">
          <label htmlFor="entry-title" className="text-sm font-medium">
            {te("titleLabel")} <span className="text-destructive">*</span>
          </label>
          <Input id="entry-title" value={title} onChange={(e) => { setTitle(e.target.value); setTitleMissing(false); }} placeholder={te("titlePlaceholder")} maxLength={200} className={cn(titleMissing && "border-destructive")} />
          {titleMissing && <p className="text-xs text-destructive">{t("errors.required")}</p>}
        </div>
      )}
      {visible.map((el) => (
        <ElementInput key={el.key} element={el} value={answers[el.key]} onChange={(v) => setValue(el.key, v)} issue={issueFor(el.key)} disabled={pending} />
      ))}
      {mode === "edit" && (
        <div className="grid grid-cols-1 gap-1.5">
          <label htmlFor="entry-change-note" className="text-sm font-medium">
            {te("changeNoteLabel")}
          </label>
          <Input id="entry-change-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder={te("changeNotePlaceholder")} maxLength={500} />
        </div>
      )}
      {mode !== "preview" && (
        <div>
          <Button type="submit" disabled={pending}>
            {mode === "edit" ? t("save") : t("create")}
          </Button>
        </div>
      )}
    </form>
  );
}

function ElementInput({ element, value, onChange, issue, disabled }: { element: StructureElement; value: StructureAnswers[string] | undefined; onChange: (v: StructureAnswers[string]) => void; issue?: AnswerIssue; disabled: boolean }) {
  const t = useTranslations("knowledge.structured");

  if (element.type === "info") {
    return (
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <Markdown>{element.body}</Markdown>
      </div>
    );
  }

  const errorText = issue ? t(`errors.${issue.code}`, { count: issue.count ?? 0 }) : null;
  const header = (
    <div className="text-sm font-medium">
      {element.label} {element.required && <span className="text-destructive">*</span>}
    </div>
  );
  const help = element.help ? <p className="text-xs text-muted-foreground">{element.help}</p> : null;
  const error = errorText ? <p className="text-xs text-destructive">{errorText}</p> : null;

  switch (element.type) {
    case "text":
      return (
        <div className="grid grid-cols-1 gap-1.5">
          {header}
          {help}
          <Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={element.placeholder} maxLength={element.maxLength ?? 2000} disabled={disabled} className={cn(issue && "border-destructive")} />
          {error}
        </div>
      );
    case "textarea":
      return (
        <div className="grid grid-cols-1 gap-1.5">
          {header}
          {help}
          <Textarea value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={element.placeholder} maxLength={element.maxLength ?? 50000} rows={5} disabled={disabled} className={cn(issue && "border-destructive")} />
          {error}
        </div>
      );
    case "select":
      return (
        <div className="grid grid-cols-1 gap-1.5">
          {header}
          {help}
          <Select value={(value as string) ?? ""} onValueChange={(v) => onChange(v)} disabled={disabled}>
            <SelectTrigger className={cn("max-w-72", issue && "border-destructive")}>
              <SelectValue placeholder={element.placeholder ?? "–"} />
            </SelectTrigger>
            <SelectContent>
              {element.options.filter((o) => o.trim()).map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error}
        </div>
      );
    case "chips": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="grid grid-cols-1 gap-1.5">
          {header}
          {help}
          <div className="flex flex-wrap gap-1.5">
            {element.options.filter((o) => o.trim()).map((o) => {
              const on = arr.includes(o);
              return (
                <button key={o} type="button" disabled={disabled} aria-pressed={on} onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])} className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
                  {o}
                </button>
              );
            })}
          </div>
          {error}
        </div>
      );
    }
    case "checkbox": {
      const on = value === true;
      return (
        <div className="grid grid-cols-1 gap-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} disabled={disabled} className="size-4 accent-primary" />
            <span>
              {element.label} {element.required && <span className="text-destructive">*</span>}
            </span>
          </label>
          {help}
          {error}
        </div>
      );
    }
    case "qa": {
      const pairs: QaPair[] = Array.isArray(value) ? (value as QaPair[]) : [];
      const update = (idx: number, patch: Partial<QaPair>) => onChange(pairs.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
      return (
        <div className="grid grid-cols-1 gap-1.5">
          {header}
          {help}
          <div className="grid grid-cols-1 gap-2">
            {pairs.map((p, i) => (
              <div key={i} className="grid grid-cols-1 gap-1.5 rounded-md border p-2">
                <div className="flex items-start gap-2">
                  <Input value={p.question} onChange={(e) => update(i, { question: e.target.value })} placeholder={element.questionLabel ?? t("question")} maxLength={1000} disabled={disabled} className="text-sm" />
                  <Button type="button" variant="ghost" size="icon" aria-label={t("removePair")} disabled={disabled} onClick={() => onChange(pairs.filter((_, x) => x !== i))}>
                    <X className="size-4" />
                  </Button>
                </div>
                <Textarea value={p.answer} onChange={(e) => update(i, { answer: e.target.value })} placeholder={element.answerLabel ?? t("answer")} rows={2} maxLength={10000} disabled={disabled} className="text-sm" />
              </div>
            ))}
          </div>
          <div>
            <Button type="button" variant="outline" size="sm" disabled={disabled || (element.maxPairs !== undefined && pairs.length >= element.maxPairs)} onClick={() => onChange([...pairs, { question: "", answer: "" }])}>
              <Plus className="size-3.5" /> {t("addPair")}
            </Button>
          </div>
          {error}
        </div>
      );
    }
    case "process": {
      const graph = (value as ProcessGraph | undefined) ?? structuredClone(element.seed);
      return (
        <div className="grid grid-cols-1 gap-1.5">
          {header}
          {help}
          <ProcessGraphEditor value={graph} onChange={(g) => onChange(g)} />
          {error}
        </div>
      );
    }
  }
}
