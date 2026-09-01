"use client";

import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, RefreshCw, X } from "lucide-react";
import type { AnswerIssue } from "@/lib/structures/validate";
import { validateStructureAnswers } from "@/lib/structures/validate";
import type { ImageAnswer, LinkAnswer, MarkdownSection, ProcessGraph, QaPair, StructureAnswers, StructureDefinition, StructureElement, VideoAnswer } from "@/lib/structures/types";
import { fillProcessSeeds, isAnswerable, isMarkdownSectionArray } from "@/lib/structures/types";
import { migrateStructureAnswers } from "@/lib/structures/migrate";
import { visibleElements } from "@/lib/structures/visibility";
import { saveStructuredEntryAction } from "@/server/actions/structured-content";
import { Markdown } from "@/components/content/markdown";
import { MediaInput, type MediaInputValue } from "@/components/content/media-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const ProcessGraphEditor = dynamic(() => import("./process-graph-editor").then((m) => m.ProcessGraphEditor), { ssr: false });

export type StructureFillFormProps = {
  def: StructureDefinition;
  mode: "create" | "edit" | "preview";
  areaId?: string;
  areaSlug?: string;
  contentId?: string;
  /** create mode: the template the entry is created from */
  templateId?: string;
  /** edit mode: newer version of the entry's template, offered as an opt-in upgrade */
  upgradeTo?: { version: number; definition: StructureDefinition };
  maxUploadMb?: number;
  initialTitle?: string;
  initialAnswers?: StructureAnswers;
  /** edit mode: the entry image of the current version (version.mediaId) */
  initialImageMediaId?: string;
};

export function StructureFillForm({ def, mode, areaId, contentId, templateId, upgradeTo, maxUploadMb, initialTitle, initialAnswers, initialImageMediaId }: StructureFillFormProps) {
  const t = useTranslations("knowledge.structured");
  const te = useTranslations("knowledge.editor");
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle ?? "");
  const [image, setImage] = useState<MediaInputValue | undefined>(initialImageMediaId ? { mediaId: initialImageMediaId } : undefined);
  const [answers, setAnswers] = useState<StructureAnswers>(initialAnswers ?? {});
  const [changeNote, setChangeNote] = useState("");
  const [issues, setIssues] = useState<AnswerIssue[]>([]);
  const [titleMissing, setTitleMissing] = useState(false);
  const [pending, start] = useTransition();
  const [upgrading, setUpgrading] = useState(false);
  const [droppedLabels, setDroppedLabels] = useState<string[]>([]);

  // Derived, not state: the def prop changes live in the template editor's preview.
  const activeDef = upgrading && upgradeTo ? upgradeTo.definition : def;

  const startUpgrade = () => {
    if (!upgradeTo) return;
    const res = migrateStructureAnswers(def, upgradeTo.definition, answers);
    const labelByKey = new Map(def.elements.filter(isAnswerable).map((el) => [el.key, el.label]));
    setDroppedLabels(res.droppedKeys.map((k) => labelByKey.get(k) ?? k));
    setAnswers(res.answers);
    setIssues([]);
    setUpgrading(true);
  };

  const cancelUpgrade = () => {
    setAnswers(initialAnswers ?? {});
    setDroppedLabels([]);
    setIssues([]);
    setUpgrading(false);
  };

  const visible = useMemo(() => visibleElements(activeDef, answers), [activeDef, answers]);
  const issueFor = (key: string) => issues.find((i) => i.key === key);

  const setValue = (key: string, value: StructureAnswers[string] | undefined) => {
    setAnswers((a) => {
      if (value === undefined) {
        const next = { ...a };
        delete next[key];
        return next;
      }
      return { ...a, [key]: value };
    });
    setIssues((prev) => prev.filter((i) => i.key !== key));
  };

  const submit = () => {
    const missingTitle = !title.trim();
    setTitleMissing(missingTitle);
    // Untouched process elements submit their seed graph as the answer.
    const effective = fillProcessSeeds(activeDef, answers);
    const res = validateStructureAnswers(activeDef, effective);
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
        templateId,
        contentId,
        title: title.trim(),
        answers: res.answers,
        changeNote: changeNote.trim() || undefined,
        upgrade: upgrading || undefined,
        // always sent: the current image state, so edits keep or remove it explicitly
        imageMediaId: image?.mediaId ?? null,
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
      {mode === "edit" && upgradeTo && !upgrading && (
        <div className="grid gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <p>{t("templateChanged")}</p>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={startUpgrade} disabled={pending}>
              <RefreshCw className="size-3.5" /> {t("updateToNew", { version: upgradeTo.version })}
            </Button>
          </div>
        </div>
      )}
      {upgrading && (
        <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <p>{t("upgradeActive", { version: upgradeTo?.version ?? 0 })}</p>
          {droppedLabels.length > 0 && <p className="text-muted-foreground">{t("droppedAnswers", { labels: droppedLabels.join(", ") })}</p>}
          <div>
            <Button type="button" variant="ghost" size="sm" onClick={cancelUpgrade} disabled={pending}>
              {t("cancelUpgrade")}
            </Button>
          </div>
        </div>
      )}
      {activeDef.intro && (
        <div className="text-sm text-muted-foreground">
          <Markdown>{activeDef.intro}</Markdown>
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
      {mode !== "preview" && (
        <div className="grid grid-cols-1 gap-1.5">
          <span className="text-sm font-medium">{te("entryImageLabel")}</span>
          <MediaInput kind="image" value={image} onChange={setImage} maxUploadMb={maxUploadMb ?? 25} disabled={pending} allowUrl={false} />
          <p className="text-xs text-muted-foreground">{te("entryImageHint")}</p>
        </div>
      )}
      {visible.map((el) => (
        <ElementInput key={el.key} element={el} value={answers[el.key]} onChange={(v) => setValue(el.key, v)} issue={issueFor(el.key)} disabled={pending} maxUploadMb={maxUploadMb ?? 25} />
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

function ElementInput({ element, value, onChange, issue, disabled, maxUploadMb }: { element: StructureElement; value: StructureAnswers[string] | undefined; onChange: (v: StructureAnswers[string] | undefined) => void; issue?: AnswerIssue; disabled: boolean; maxUploadMb: number }) {
  const t = useTranslations("knowledge.structured");
  const te = useTranslations("knowledge.editor");

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
    case "markdown": {
      if (element.multiple) {
        const sections: MarkdownSection[] = isMarkdownSectionArray(value) ? value : [];
        const update = (idx: number, patch: Partial<MarkdownSection>) => onChange(sections.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
        const move = (idx: number, delta: -1 | 1) => {
          const swap = idx + delta;
          if (swap < 0 || swap >= sections.length) return;
          const next = [...sections];
          [next[idx], next[swap]] = [next[swap], next[idx]];
          onChange(next);
        };
        return (
          <div className="grid grid-cols-1 gap-1.5">
            {header}
            {help}
            <div className="grid grid-cols-1 gap-2">
              {sections.map((s, i) => (
                <div key={i} className="grid grid-cols-1 gap-1.5 rounded-md border p-2">
                  <div className="flex items-start gap-2">
                    <Input value={s.title} onChange={(e) => update(i, { title: e.target.value })} placeholder={t("sectionTitle")} maxLength={200} disabled={disabled} className="text-sm" />
                    <Button type="button" variant="ghost" size="icon" aria-label={t("sectionUp")} disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={t("sectionDown")} disabled={disabled || i === sections.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={t("removeSection")} disabled={disabled} onClick={() => onChange(sections.filter((_, x) => x !== i))}>
                      <X className="size-4" />
                    </Button>
                  </div>
                  <Textarea value={s.body} onChange={(e) => update(i, { body: e.target.value })} placeholder={element.placeholder} maxLength={element.maxLength ?? 200000} rows={6} disabled={disabled} className="font-mono text-sm leading-relaxed" />
                </div>
              ))}
            </div>
            <div>
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...sections, { title: "", body: "" }])}>
                <Plus className="size-3.5" /> {t("addSection")}
              </Button>
            </div>
            {error}
          </div>
        );
      }
      const text = typeof value === "string" ? value : "";
      return (
        <div className="grid grid-cols-1 gap-1.5">
          {header}
          {help}
          <Tabs defaultValue="write">
            <TabsList>
              <TabsTrigger value="write">{te("write")}</TabsTrigger>
              <TabsTrigger value="preview">{te("preview")}</TabsTrigger>
            </TabsList>
            <TabsContent value="write" className="pt-2">
              <Textarea value={text} onChange={(e) => onChange(e.target.value)} placeholder={element.placeholder} maxLength={element.maxLength ?? 200000} rows={12} disabled={disabled} className={cn("font-mono text-sm leading-relaxed", issue && "border-destructive")} />
            </TabsContent>
            <TabsContent value="preview" className="pt-2">
              <div className="min-h-32 rounded-md border p-4">{text.trim() ? <Markdown>{text}</Markdown> : <p className="text-sm text-muted-foreground">{te("nothingToPreview")}</p>}</div>
            </TabsContent>
          </Tabs>
          {error}
        </div>
      );
    }
    case "image": {
      const v = (value as ImageAnswer | undefined) ?? undefined;
      return (
        <div className="grid grid-cols-1 gap-1.5">
          {header}
          {help}
          <MediaInput kind="image" value={v} onChange={(next) => onChange((next ? { ...next, ...(v?.alt ? { alt: v.alt } : {}) } : undefined) as StructureAnswers[string])} maxUploadMb={maxUploadMb} disabled={disabled} invalid={!!issue} />
          <Input value={v?.alt ?? ""} onChange={(e) => onChange({ ...(v ?? {}), alt: e.target.value } as StructureAnswers[string])} placeholder={te("altLabel")} maxLength={500} disabled={disabled} />
          {error}
        </div>
      );
    }
    case "video": {
      const v = (value as VideoAnswer | undefined) ?? undefined;
      return (
        <div className="grid grid-cols-1 gap-1.5">
          {header}
          {help}
          <MediaInput kind="video" value={v} onChange={(next) => onChange(next as StructureAnswers[string])} maxUploadMb={maxUploadMb} disabled={disabled} invalid={!!issue} />
          {error}
        </div>
      );
    }
    case "link": {
      const v = (value as LinkAnswer | undefined) ?? undefined;
      return (
        <div className="grid grid-cols-1 gap-1.5">
          {header}
          {help}
          <Input type="url" value={v?.url ?? ""} onChange={(e) => onChange((e.target.value.trim() ? { url: e.target.value } : undefined) as StructureAnswers[string])} placeholder={te("urlPlaceholder")} maxLength={2000} disabled={disabled} className={cn(issue && "border-destructive")} />
          {error}
        </div>
      );
    }
  }
}
