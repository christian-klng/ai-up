"use client";

import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlignLeft, ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, ChevronsUpDown, FileText, GitBranch, Image as ImageIcon, Info, Link2, MessageSquare, Plus, Tags, Trash2, Type, Video } from "lucide-react";
import { saveTemplateAction, deleteTemplateAction } from "@/server/actions/admin-templates";
import type { ValidationIssue } from "@/lib/structures/validate";
import type { ProcessGraph, ShowIf, StructureDefinition, StructureElement, StructureElementType } from "@/lib/structures/types";
import { emptyEvaluation, type TemplateEvaluation } from "@/lib/structures/evaluation";
import { emptyProcessGraph, isAnswerable } from "@/lib/structures/types";
import { StructureFillForm } from "@/components/structures/structure-fill-form";
import { IconPicker } from "@/components/common/icon-picker";
import { EvaluationEditor } from "@/components/structures/evaluation-editor";
import type { LlmProviderOption } from "@/components/common/llm-model-select";
import { TEMPLATE_ICON_KEYS, TemplateIcon } from "@/components/structures/template-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const ProcessGraphEditor = dynamic(() => import("./process-graph-editor").then((m) => m.ProcessGraphEditor), { ssr: false });

const ELEMENT_ICONS: Record<StructureElementType, React.ComponentType<{ className?: string }>> = {
  info: Info,
  text: Type,
  textarea: AlignLeft,
  select: ChevronsUpDown,
  chips: Tags,
  checkbox: Check,
  qa: MessageSquare,
  process: GitBranch,
  markdown: FileText,
  image: ImageIcon,
  link: Link2,
  video: Video,
};

const ELEMENT_TYPES: StructureElementType[] = ["info", "text", "textarea", "markdown", "select", "chips", "checkbox", "qa", "process", "image", "link", "video"];

function newElement(type: StructureElementType, key: string, label: string): StructureElement {
  const base = { key, label };
  switch (type) {
    case "info":
      return { ...base, type, body: "…" };
    case "text":
    case "textarea":
    case "markdown":
      return { ...base, type };
    case "select":
      return { ...base, type, options: ["Option 1", "Option 2"] };
    case "chips":
      return { ...base, type, options: ["Option 1", "Option 2"] };
    case "checkbox":
      return { ...base, type };
    case "qa":
      return { ...base, type };
    case "process":
      return { ...base, type, seed: emptyProcessGraph() };
    case "image":
    case "link":
    case "video":
      return { ...base, type };
  }
}

export type TemplateEditorInitial = {
  name: string;
  description: string | null;
  icon: string;
  definition: StructureDefinition;
  evaluation: TemplateEvaluation;
};

export function StructureEditor({
  templateId,
  initial,
  initialVersion,
  isSystem,
  providers,
}: {
  templateId: string | null;
  initial: TemplateEditorInitial | null;
  initialVersion: number | null;
  isSystem: boolean;
  providers: LlmProviderOption[];
}) {
  const t = useTranslations("admin.templates");
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "file-text");
  const [intro, setIntro] = useState(initial?.definition.intro ?? "");
  const [elements, setElements] = useState<StructureElement[]>(initial?.definition.elements ?? []);
  const [evaluation, setEvaluation] = useState<TemplateEvaluation>(initial?.evaluation ?? emptyEvaluation());
  const [changeNote, setChangeNote] = useState("");
  const [version, setVersion] = useState<number | null>(initialVersion);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [warnings, setWarnings] = useState<ValidationIssue[]>([]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [pending, start] = useTransition();
  const readOnly = isSystem;

  const def: StructureDefinition = useMemo(() => ({ formatVersion: 1, intro: intro.trim() || undefined, elements }), [intro, elements]);

  const addElement = (type: StructureElementType) => {
    let n = elements.length + 1;
    let key = `${type}_${n}`;
    while (elements.some((e) => e.key === key)) key = `${type}_${++n}`;
    setElements((els) => [...els, newElement(type, key, `${t(`palette.${type}`)} ${n}`)]);
    setCollapsed((c) => {
      const next = new Set(c);
      next.delete(elements.length);
      return next;
    });
  };

  const updateElement = (idx: number, patch: Partial<StructureElement>) => {
    setElements((els) => els.map((e, i) => (i === idx ? ({ ...e, ...patch } as StructureElement) : e)));
  };

  const move = (idx: number, delta: -1 | 1) => {
    setElements((els) => {
      const next = [...els];
      const swap = idx + delta;
      if (swap < 0 || swap >= next.length) return els;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  const removeElement = (idx: number) => setElements((els) => els.filter((_, i) => i !== idx));

  const toggleCollapsed = (idx: number) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const issuesFor = (idx: number) => issues.filter((i) => i.path === `elements.${idx}` || i.path.startsWith(`elements.${idx}.`));
  const globalIssues = issues.filter((i) => !i.path.startsWith("elements."));

  const save = () =>
    start(async () => {
      const res = await saveTemplateAction({
        templateId: templateId ?? undefined,
        name: name.trim(),
        description: description.trim() || undefined,
        icon,
        definition: def,
        evaluation,
        changeNote: changeNote.trim() || undefined,
      });
      if (res.ok) {
        setIssues([]);
        setWarnings(res.warnings);
        setVersion(res.version);
        setChangeNote("");
        toast.success(t("saved", { no: res.version }));
        if (!templateId) {
          router.replace(`/admin/templates/${res.templateId}`);
        }
        router.refresh();
      } else {
        setIssues(res.issues);
        setWarnings([]);
        toast.error(t("issues"));
      }
    });

  const remove = () => {
    if (!templateId || !confirm(t("removeConfirm"))) return;
    start(async () => {
      const res = await deleteTemplateAction(templateId);
      if (res.ok) {
        toast.success(t("removed"));
        router.push("/admin/templates");
        router.refresh();
      }
    });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="grid grid-cols-1 content-start gap-4">
        {readOnly && <p className="rounded-md border bg-muted/40 p-2 text-sm text-muted-foreground">{t("systemHint")}</p>}

        <div className="grid grid-cols-1 gap-1.5">
          <label htmlFor="template-name" className="text-sm font-medium">
            {t("nameLabel")} <span className="text-destructive">*</span>
          </label>
          <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} disabled={readOnly} />
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          <label htmlFor="template-description" className="text-sm font-medium">
            {t("descriptionLabel")}
          </label>
          <Textarea id="template-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} disabled={readOnly} />
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          <label htmlFor="template-icon" className="text-sm font-medium">
            {t("iconLabel")}
          </label>
          <IconPicker id="template-icon" value={icon} onChange={setIcon} keys={TEMPLATE_ICON_KEYS} Icon={TemplateIcon} disabled={readOnly} />
        </div>

        <div className="grid grid-cols-1 gap-1.5">
          <label htmlFor="structure-intro" className="text-sm font-medium">
            {t("introLabel")}
          </label>
          <Textarea id="structure-intro" value={intro} onChange={(e) => setIntro(e.target.value)} rows={2} maxLength={5000} disabled={readOnly} />
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("elements")}</h2>
          {!readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={pending}>
                  <Plus className="size-3.5" /> {t("addElement")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {ELEMENT_TYPES.map((type) => {
                  const Icon = ELEMENT_ICONS[type];
                  return (
                    <DropdownMenuItem key={type} onClick={() => addElement(type)}>
                      <Icon className="size-4" /> {t(`palette.${type}`)}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {globalIssues.length > 0 && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            {globalIssues.map((i, n) => (
              <div key={n}>
                {i.path ? `${i.path}: ` : ""}
                {i.message}
              </div>
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
            <div className="font-medium">{t("warnings")}</div>
            {warnings.map((w, n) => (
              <div key={n}>
                {w.path ? `${w.path}: ` : ""}
                {w.message}
              </div>
            ))}
          </div>
        )}

        {elements.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}

        <div className="grid grid-cols-1 gap-2">
          {elements.map((el, i) => (
            <ElementCard
              key={i}
              element={el}
              index={i}
              total={elements.length}
              earlier={elements.slice(0, i).filter(isAnswerable)}
              collapsed={collapsed.has(i)}
              issues={issuesFor(i)}
              disabled={pending || readOnly}
              onToggle={() => toggleCollapsed(i)}
              onChange={(patch) => updateElement(i, patch)}
              onMove={(d) => move(i, d)}
              onRemove={() => removeElement(i)}
            />
          ))}
        </div>

        <EvaluationEditor
          value={evaluation}
          onChange={setEvaluation}
          providers={providers}
          disabled={pending}
          templateId={templateId}
          standalone={readOnly}
        />

        {!readOnly && (
          <>
            <div className="grid grid-cols-1 gap-1.5">
              <label htmlFor="structure-change-note" className="text-sm font-medium">
                {t("changeNoteLabel")}
              </label>
              <Input id="structure-change-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} maxLength={500} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={save} disabled={pending || elements.length === 0 || !name.trim()}>
                {t("save")}
              </Button>
              {version !== null && templateId && (
                <Button type="button" variant="ghost" className="text-destructive" onClick={remove} disabled={pending}>
                  <Trash2 className="size-4" /> {t("remove")}
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 content-start gap-2 lg:border-l lg:pl-6">
        <h2 className="text-sm font-semibold">{t("preview")}</h2>
        <p className="text-xs text-muted-foreground">{t("previewHint")}</p>
        <div className="rounded-lg border bg-card p-4">
          <StructureFillForm def={def} mode="preview" />
        </div>
      </div>
    </div>
  );
}

function ElementCard({
  element,
  index,
  total,
  earlier,
  collapsed,
  issues,
  disabled,
  onToggle,
  onChange,
  onMove,
  onRemove,
}: {
  element: StructureElement;
  index: number;
  total: number;
  earlier: StructureElement[];
  collapsed: boolean;
  issues: ValidationIssue[];
  disabled: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<StructureElement>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("admin.templates");
  const Icon = ELEMENT_ICONS[element.type];
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className={cn("rounded-md border bg-card", issues.length > 0 && "border-destructive/60")}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={!collapsed}>
          {collapsed ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{element.label}</span>
          <span className="truncate text-xs text-muted-foreground">{t(`palette.${element.type}`)}</span>
        </button>
        <Button type="button" variant="ghost" size="icon" aria-label={t("moveUp")} disabled={disabled || index === 0} onClick={() => onMove(-1)}>
          <ArrowUp className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label={t("moveDown")} disabled={disabled || index === total - 1} onClick={() => onMove(1)}>
          <ArrowDown className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label={t("removeElement")} disabled={disabled} onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      {issues.length > 0 && (
        <div className="border-t border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {issues.map((i, n) => (
            <div key={n}>{i.message}</div>
          ))}
        </div>
      )}
      {!collapsed && (
        <div className={cn("grid grid-cols-1 gap-3 border-t p-3", disabled && "pointer-events-none opacity-60")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="grid grid-cols-1 gap-1 text-xs font-medium">
              {t("labelLabel")}
              <Input value={element.label} onChange={(e) => onChange({ label: e.target.value })} maxLength={200} className="h-8 text-sm" />
            </label>
            <label className="grid grid-cols-1 gap-1 text-xs font-medium">
              {t("helpLabel")}
              <Input value={element.help ?? ""} onChange={(e) => onChange({ help: e.target.value || undefined })} maxLength={1000} className="h-8 text-sm" />
            </label>
          </div>

          <TypeConfig element={element} onChange={onChange} />

          {element.type !== "info" && (
            <label className="flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={element.required ?? false} onChange={(e) => onChange({ required: e.target.checked || undefined })} className="size-3.5 accent-primary" />
              {t("requiredLabel")}
            </label>
          )}

          <ShowIfPicker element={element} earlier={earlier} onChange={(showIf) => onChange({ showIf })} />

          <button type="button" onClick={() => setShowAdvanced((s) => !s)} className="w-fit text-xs text-muted-foreground underline-offset-2 hover:underline">
            {t("advanced")}
          </button>
          {showAdvanced && (
            <label className="grid grid-cols-1 gap-1 text-xs font-medium">
              {t("keyLabel")}
              <Input value={element.key} onChange={(e) => onChange({ key: e.target.value })} maxLength={40} className="h-8 font-mono text-sm" />
              <span className="font-normal text-muted-foreground">{t("keyHint")}</span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function TypeConfig({ element, onChange }: { element: StructureElement; onChange: (patch: Partial<StructureElement>) => void }) {
  const t = useTranslations("admin.templates");

  const numberInput = (label: string, value: number | undefined, set: (n: number | undefined) => void) => (
    <label className="grid grid-cols-1 gap-1 text-xs font-medium">
      {label}
      <Input
        type="number"
        min={0}
        value={value ?? ""}
        onChange={(e) => set(e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)))}
        className="h-8 w-28 text-sm"
      />
    </label>
  );

  switch (element.type) {
    case "info":
      return (
        <label className="grid grid-cols-1 gap-1 text-xs font-medium">
          {t("bodyLabel")}
          <Textarea value={element.body} onChange={(e) => onChange({ body: e.target.value } as Partial<StructureElement>)} rows={3} maxLength={10000} className="text-sm" />
        </label>
      );
    case "text":
    case "textarea":
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="grid grid-cols-1 gap-1 text-xs font-medium">
            {t("placeholderLabel")}
            <Input value={element.placeholder ?? ""} onChange={(e) => onChange({ placeholder: e.target.value || undefined } as Partial<StructureElement>)} maxLength={200} className="h-8 text-sm" />
          </label>
          {numberInput(t("maxLabel"), element.maxLength, (n) => onChange({ maxLength: n } as Partial<StructureElement>))}
        </div>
      );
    case "markdown":
      return (
        <div className="grid grid-cols-1 gap-3">
          <div className="grid grid-cols-1 gap-1">
            <label className="flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={element.multiple ?? false} onChange={(e) => onChange({ multiple: e.target.checked || undefined } as Partial<StructureElement>)} className="size-3.5 accent-primary" />
              {t("multipleLabel")}
            </label>
            <p className="text-xs text-muted-foreground">{t("multipleHint")}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="grid grid-cols-1 gap-1 text-xs font-medium">
              {t("placeholderLabel")}
              <Input value={element.placeholder ?? ""} onChange={(e) => onChange({ placeholder: e.target.value || undefined } as Partial<StructureElement>)} maxLength={200} className="h-8 text-sm" />
            </label>
            {numberInput(t("maxLabel"), element.maxLength, (n) => onChange({ maxLength: n } as Partial<StructureElement>))}
          </div>
        </div>
      );
    case "select":
      return (
        <div className="grid grid-cols-1 gap-3">
          <label className="grid grid-cols-1 gap-1 text-xs font-medium">
            {t("optionsLabel")}
            <Textarea value={element.options.join("\n")} onChange={(e) => onChange({ options: e.target.value.split("\n") } as Partial<StructureElement>)} rows={3} className="text-sm" />
          </label>
          <label className="grid grid-cols-1 gap-1 text-xs font-medium">
            {t("placeholderLabel")}
            <Input value={element.placeholder ?? ""} onChange={(e) => onChange({ placeholder: e.target.value || undefined } as Partial<StructureElement>)} maxLength={200} className="h-8 text-sm" />
          </label>
        </div>
      );
    case "chips":
      return (
        <div className="grid grid-cols-1 gap-3">
          <label className="grid grid-cols-1 gap-1 text-xs font-medium">
            {t("optionsLabel")}
            <Textarea value={element.options.join("\n")} onChange={(e) => onChange({ options: e.target.value.split("\n") } as Partial<StructureElement>)} rows={3} className="text-sm" />
          </label>
          <div className="flex gap-3">
            {numberInput(t("minLabel"), element.minSelected, (n) => onChange({ minSelected: n } as Partial<StructureElement>))}
            {numberInput(t("maxLabel"), element.maxSelected, (n) => onChange({ maxSelected: n } as Partial<StructureElement>))}
          </div>
        </div>
      );
    case "checkbox":
      return null;
    case "qa":
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="grid grid-cols-1 gap-1 text-xs font-medium">
            {t("questionLabelLabel")}
            <Input value={element.questionLabel ?? ""} onChange={(e) => onChange({ questionLabel: e.target.value || undefined } as Partial<StructureElement>)} maxLength={200} className="h-8 text-sm" />
          </label>
          <label className="grid grid-cols-1 gap-1 text-xs font-medium">
            {t("answerLabelLabel")}
            <Input value={element.answerLabel ?? ""} onChange={(e) => onChange({ answerLabel: e.target.value || undefined } as Partial<StructureElement>)} maxLength={200} className="h-8 text-sm" />
          </label>
          {numberInput(t("minLabel"), element.minPairs, (n) => onChange({ minPairs: n } as Partial<StructureElement>))}
          {numberInput(t("maxLabel"), element.maxPairs, (n) => onChange({ maxPairs: n } as Partial<StructureElement>))}
        </div>
      );
    case "process":
      return (
        <div className="grid grid-cols-1 gap-1">
          <div className="text-xs font-medium">{t("seedLabel")}</div>
          <p className="text-xs text-muted-foreground">{t("seedHint")}</p>
          <ProcessGraphEditor key={element.key} value={element.seed} onChange={(seed: ProcessGraph) => onChange({ seed } as Partial<StructureElement>)} />
        </div>
      );
  }
}

function ShowIfPicker({ element, earlier, onChange }: { element: StructureElement; earlier: StructureElement[]; onChange: (showIf: ShowIf | undefined) => void }) {
  const t = useTranslations("admin.templates");
  const cond = element.showIf;
  const target = cond ? earlier.find((e) => e.key === cond.key) : undefined;

  const operatorFor = (c: ShowIf): "equals" | "includes" | "notEmpty" => (c.includes !== undefined ? "includes" : c.equals !== undefined ? "equals" : "notEmpty");

  const defaultCondFor = (el: StructureElement): ShowIf => {
    switch (el.type) {
      case "checkbox":
        return { key: el.key, equals: true };
      case "chips":
        return { key: el.key, includes: el.options[0] ?? "" };
      case "select":
        return { key: el.key, equals: el.options[0] ?? "" };
      case "text":
      case "textarea":
        return { key: el.key, equals: "" };
      default:
        return { key: el.key, notEmpty: true };
    }
  };

  const operatorOptions = (el: StructureElement): ("equals" | "includes" | "notEmpty")[] => {
    switch (el.type) {
      case "checkbox":
      case "select":
      case "text":
      case "textarea":
        return ["equals", "notEmpty"];
      case "chips":
        return ["includes", "notEmpty"];
      default:
        return ["notEmpty"];
    }
  };

  return (
    <div className="grid grid-cols-1 gap-1.5">
      <div className="text-xs font-medium">{t("showIfLabel")}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={cond?.key ?? "__always__"}
          onValueChange={(v) => {
            if (v === "__always__") return onChange(undefined);
            const el = earlier.find((e) => e.key === v);
            if (el) onChange(defaultCondFor(el));
          }}
        >
          <SelectTrigger className="h-8 w-52 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__always__">{t("showIfAlways")}</SelectItem>
            {earlier.map((e) => (
              <SelectItem key={e.key} value={e.key}>
                {e.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {cond && target && (
          <Select
            value={operatorFor(cond)}
            onValueChange={(op) => {
              if (op === "notEmpty") onChange({ key: cond.key, notEmpty: true });
              else if (op === "includes") onChange({ key: cond.key, includes: target.type === "chips" ? (target.options[0] ?? "") : "" });
              else onChange(target.type === "checkbox" ? { key: cond.key, equals: true } : { key: cond.key, equals: target.type === "select" ? (target.options[0] ?? "") : "" });
            }}
          >
            <SelectTrigger className="h-8 w-36 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operatorOptions(target).map((op) => (
                <SelectItem key={op} value={op}>
                  {op === "equals" ? t("showIfEquals") : op === "includes" ? t("showIfIncludes") : t("showIfNotEmpty")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {cond && target && cond.notEmpty === undefined && (
          <ShowIfValueInput cond={cond} target={target} onChange={onChange} yesLabel={t("yes")} noLabel={t("no")} valueLabel={t("showIfValueLabel")} />
        )}
      </div>
    </div>
  );
}

function ShowIfValueInput({ cond, target, onChange, yesLabel, noLabel, valueLabel }: { cond: ShowIf; target: StructureElement; onChange: (showIf: ShowIf) => void; yesLabel: string; noLabel: string; valueLabel: string }) {
  if (target.type === "checkbox") {
    return (
      <Select value={cond.equals === false ? "no" : "yes"} onValueChange={(v) => onChange({ key: cond.key, equals: v === "yes" })}>
        <SelectTrigger className="h-8 w-28 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="yes">{yesLabel}</SelectItem>
          <SelectItem value="no">{noLabel}</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (target.type === "select" || target.type === "chips") {
    const value = cond.includes ?? (typeof cond.equals === "string" ? cond.equals : "");
    return (
      <Select value={value} onValueChange={(v) => onChange(cond.includes !== undefined ? { key: cond.key, includes: v } : { key: cond.key, equals: v })}>
        <SelectTrigger className="h-8 w-44 text-sm">
          <SelectValue placeholder={valueLabel} />
        </SelectTrigger>
        <SelectContent>
          {target.options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return <Input value={typeof cond.equals === "string" ? cond.equals : ""} onChange={(e) => onChange({ key: cond.key, equals: e.target.value })} placeholder={valueLabel} className="h-8 w-44 text-sm" />;
}
