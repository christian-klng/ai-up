"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, MessageSquareText, X } from "lucide-react";
import { useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { answerQuestionAction, dismissQuestionAction } from "@/server/actions/questions";
import type { QuestionDto } from "@/lib/realtime-events";
import type { QuestionField } from "@/server/db/schema";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Bottom-left dock with open questions (surveys, ratings, calls to action) created by workflows.
 * New questions arrive live; answering removes the card and fires the `question.answered` trigger.
 */
export function QuestionDock({ initial }: { initial: QuestionDto[] }) {
  const t = useTranslations("questions");
  const [items, setItems] = useState<QuestionDto[]>(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setItems(initial);
  }
  const [collapsed, setCollapsed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [pending, start] = useTransition();

  useRealtimeEvent("question.created", ({ question }) => {
    setItems((prev) => (prev.some((q) => q.id === question.id) ? prev : [question, ...prev]));
    setCollapsed(false);
  });
  useRealtimeEvent("question.closed", ({ questionId }) => setItems((prev) => prev.filter((q) => q.id !== questionId)));

  if (items.length === 0) return null;
  const current = items[0];
  const values = answers[current.id] ?? {};
  const setValue = (key: string, v: unknown) => setAnswers((a) => ({ ...a, [current.id]: { ...(a[current.id] ?? {}), [key]: v } }));
  const missingRequired = current.fields.some((f) => f.type !== "cta" && f.required && (values[f.key] === undefined || values[f.key] === "" || (Array.isArray(values[f.key]) && (values[f.key] as unknown[]).length === 0)));

  const submit = (extra?: Record<string, unknown>) =>
    start(async () => {
      const res = await answerQuestionAction(current.id, { ...values, ...(extra ?? {}) });
      if (res.ok) {
        toast.success(t("thanks"));
        setItems((prev) => prev.filter((q) => q.id !== current.id));
      } else toast.error(res.error);
    });

  const dismiss = () =>
    start(async () => {
      await dismissQuestionAction(current.id);
      setItems((prev) => prev.filter((q) => q.id !== current.id));
    });

  return (
    <div className="fixed bottom-4 left-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)]">
      {collapsed ? (
        <button type="button" onClick={() => setCollapsed(false)} className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm shadow-lg hover:bg-accent">
          <MessageSquareText className="size-4 text-primary" /> {t("pending", { count: items.length })} <ChevronUp className="size-4" />
        </button>
      ) : (
        <div className="rounded-lg border bg-card shadow-xl animate-in slide-in-from-bottom-4 fade-in">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <MessageSquareText className="size-4 text-primary" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{current.workflowName ? t("fromWorkflow", { name: current.workflowName }) : t("question")}</span>
            {items.length > 1 && <span className="rounded-full bg-muted px-1.5 text-[10px]">{items.length}</span>}
            <button type="button" onClick={() => setCollapsed(true)} className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent" aria-label={t("collapse")}>
              <ChevronDown className="size-4" />
            </button>
            {current.allowDismiss && (
              <button type="button" onClick={dismiss} className="rounded p-0.5 text-muted-foreground hover:bg-accent" aria-label={t("later")}>
                <X className="size-4" />
              </button>
            )}
          </div>
          <form
            className="grid gap-3 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div>
              <div className="text-sm font-medium">{current.title}</div>
              {current.description && <p className="mt-0.5 text-xs text-muted-foreground">{current.description}</p>}
            </div>
            {current.fields.map((f) => (
              <FieldInput key={f.key} field={f} value={values[f.key]} onChange={(v) => setValue(f.key, v)} onCta={() => submit({ [f.key]: true })} disabled={pending} />
            ))}
            <div className="flex items-center gap-2">
              {current.fields.some((f) => f.type !== "cta") && (
                <Button type="submit" size="sm" disabled={pending || missingRequired}>
                  {t("send")}
                </Button>
              )}
              {current.allowDismiss && (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={dismiss}>
                  {t("later")}
                </Button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function FieldInput({ field, value, onChange, onCta, disabled }: { field: QuestionField; value: unknown; onChange: (v: unknown) => void; onCta: () => void; disabled: boolean }) {
  const t = useTranslations("questions");
  const label = (
    <div className="text-xs font-medium">
      {field.label} {"required" in field && field.required && <span className="text-destructive">*</span>}
    </div>
  );
  switch (field.type) {
    case "single_choice":
      return (
        <div className="grid gap-1.5">
          {label}
          <div className="flex flex-wrap gap-1.5">
            {field.options.map((o) => (
              <button key={o} type="button" disabled={disabled} aria-pressed={value === o} onClick={() => onChange(o)} className={cn("rounded-full border px-3 py-1 text-sm", value === o ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
                {o}
              </button>
            ))}
          </div>
        </div>
      );
    case "multi_choice": {
      const arr = (value as string[]) ?? [];
      return (
        <div className="grid gap-1.5">
          {label}
          <div className="flex flex-wrap gap-1.5">
            {field.options.map((o) => {
              const on = arr.includes(o);
              return (
                <button key={o} type="button" disabled={disabled} aria-pressed={on} onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])} className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case "text":
      return (
        <div className="grid gap-1.5">
          {label}
          <Textarea value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} rows={2} placeholder={field.placeholder} disabled={disabled} className="text-sm" />
        </div>
      );
    case "rating": {
      const max = field.max ?? 5;
      return (
        <div className="grid gap-1.5">
          {label}
          <div className="flex gap-1">
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" disabled={disabled} aria-pressed={value === n} onClick={() => onChange(n)} className={cn("size-8 rounded-md border text-sm", value === n ? "border-primary bg-primary text-primary-foreground" : typeof value === "number" && n < value ? "bg-primary/15" : "hover:bg-accent")}>
                {n}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case "yes_no":
      return (
        <div className="grid gap-1.5">
          {label}
          <div className="flex gap-1.5">
            {[true, false].map((b) => (
              <button key={String(b)} type="button" disabled={disabled} aria-pressed={value === b} onClick={() => onChange(b)} className={cn("rounded-full border px-3 py-1 text-sm", value === b ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
                {b ? t("yes") : t("no")}
              </button>
            ))}
          </div>
        </div>
      );
    case "cta":
      return (
        <div className="grid gap-1.5">
          {label}
          {field.href ? (
            <Button type="button" size="sm" disabled={disabled} onClick={() => { const href = field.href!; onCta(); window.open(href, href.startsWith("/") ? "_self" : "_blank"); }}>
              {field.buttonLabel}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={disabled} onClick={onCta}>
              {field.buttonLabel}
            </Button>
          )}
        </div>
      );
  }
}
