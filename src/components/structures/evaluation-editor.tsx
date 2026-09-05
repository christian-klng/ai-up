"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import { reevaluateTemplateEntriesAction, saveTemplateEvaluationAction } from "@/server/actions/admin-templates";
import { MAX_CRITERIA, MAX_CRITERION_INSTRUCTION, MAX_CRITERION_TITLE, type EvaluationCriterion, type TemplateEvaluation } from "@/lib/structures/evaluation";
import { LlmModelSelect, type LlmProviderOption } from "@/components/common/llm-model-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Unique, stable key – criterion keys are never shown to users, they only tie verdict rows to a criterion. */
function nextKey(criteria: EvaluationCriterion[]): string {
  const taken = new Set(criteria.map((c) => c.key));
  for (let n = criteria.length + 1; ; n++) {
    const key = `criterion_${n}`;
    if (!taken.has(key)) return key;
  }
}

/**
 * Qualitative criteria an LLM checks against every entry of this template.
 * Criteria are not part of the structure snapshot: a change applies to all entries at once,
 * existing verdicts stay until the entry is saved again or re-checked from here.
 */
export function EvaluationEditor({
  value,
  onChange,
  providers,
  disabled,
  templateId,
  standalone,
}: {
  value: TemplateEvaluation;
  onChange: (next: TemplateEvaluation) => void;
  providers: LlmProviderOption[];
  /** form is busy; criteria stay editable for system templates, only their structure is locked */
  disabled?: boolean;
  templateId: string | null;
  /** save the criteria on their own instead of with the template form (system templates) */
  standalone?: boolean;
}) {
  const t = useTranslations("admin.templates.evaluation");
  const [pending, start] = useTransition();

  const setCriteria = (criteria: EvaluationCriterion[]) => onChange({ ...value, criteria });
  const update = (idx: number, patch: Partial<EvaluationCriterion>) => setCriteria(value.criteria.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const move = (idx: number, delta: -1 | 1) => {
    const next = [...value.criteria];
    const swap = idx + delta;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setCriteria(next);
  };

  const recheck = () =>
    start(async () => {
      const res = await reevaluateTemplateEntriesAction(templateId!);
      if (res.ok) toast.success(t("recheckQueued", { count: res.queued }));
      else toast.error(t("recheckFailed"));
    });

  const saveOnly = () =>
    start(async () => {
      const res = await saveTemplateEvaluationAction(templateId!, value);
      if (res.ok) toast.success(t("saved"));
      else toast.error(res.issues?.[0]?.message ?? t("recheckFailed"));
    });

  return (
    <div className="grid grid-cols-1 gap-3 rounded-md border bg-card p-3">
      <div>
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <p className="text-xs text-muted-foreground">{t("intro")}</p>
      </div>

      <div className="grid grid-cols-1 gap-1.5">
        <label htmlFor="evaluation-model" className="text-sm font-medium">
          {t("modelLabel")}
        </label>
        <LlmModelSelect
          id="evaluation-model"
          providers={providers}
          providerId={value.providerId}
          model={value.model}
          disabled={disabled}
          onChange={(next) => onChange({ ...value, ...next })}
        />
      </div>

      <div className="grid grid-cols-1 gap-2">
        {value.criteria.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
        {value.criteria.map((c, i) => (
          <div key={c.key} className="grid grid-cols-1 gap-2 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <Input
                value={c.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder={t("titlePlaceholder")}
                maxLength={MAX_CRITERION_TITLE}
                disabled={disabled}
                aria-label={t("criterionTitleLabel")}
                className="h-8"
              />
              <Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={t("moveUp")}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={disabled || i === value.criteria.length - 1}
                onClick={() => move(i, 1)}
                aria-label={t("moveDown")}
              >
                <ArrowDown className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-destructive"
                disabled={disabled}
                onClick={() => setCriteria(value.criteria.filter((_, n) => n !== i))}
                aria-label={t("remove")}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <Textarea
              value={c.instruction}
              onChange={(e) => update(i, { instruction: e.target.value })}
              placeholder={t("instructionPlaceholder")}
              maxLength={MAX_CRITERION_INSTRUCTION}
              rows={2}
              disabled={disabled}
              aria-label={t("criterionInstructionLabel")}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || value.criteria.length >= MAX_CRITERIA}
          onClick={() => setCriteria([...value.criteria, { key: nextKey(value.criteria), title: "", instruction: "" }])}
        >
          <Plus className="size-3.5" /> {t("add")}
        </Button>
        {standalone && templateId && (
          <Button type="button" size="sm" disabled={disabled || pending} onClick={saveOnly}>
            {t("save")}
          </Button>
        )}
        {templateId && value.criteria.length > 0 && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled || pending} onClick={recheck}>
            <RefreshCw className="size-3.5" /> {t("recheckAll")}
          </Button>
        )}
      </div>
      {templateId && value.criteria.length > 0 && <p className="text-xs text-muted-foreground">{t("recheckHint")}</p>}
    </div>
  );
}
