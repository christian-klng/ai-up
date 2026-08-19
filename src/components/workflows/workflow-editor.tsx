"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { WorkflowDefinition, WorkflowStep } from "@/server/db/schema";
import type { EditorCatalog } from "@/server/workflows/catalog";
import { saveWorkflowAction } from "@/server/actions/admin-workflows";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SchemaForm } from "./schema-form";
import { cn } from "@/lib/utils";

type Loc = "de" | "en";

function defaultConfigFor(fields: { key: string; type: string }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "content-types" || (f.type === "area" && f.key.endsWith("Ids"))) out[f.key] = [];
    if (f.type === "audience") out[f.key] = { type: "triggerUser", userIds: [] };
    if (f.type === "llm-model") {
      out.providerId = "default";
      out.model = "default";
    }
  }
  return out;
}

function nextStepId(existing: WorkflowStep[], action: string): string {
  const base = action.replace(/[^a-z0-9_]/g, "_").slice(0, 20);
  let i = 1;
  let id = base;
  while (existing.some((s) => s.id === id)) id = `${base}_${++i}`;
  return id;
}

export function WorkflowEditor({ catalog, initial, workflowId }: { catalog: EditorCatalog; initial?: WorkflowDefinition; workflowId?: string }) {
  const t = useTranslations("workflows.editor");
  const tc = useTranslations("common");
  const locale = useLocale() as Loc;
  const router = useRouter();
  const [pending, start] = useTransition();

  const firstTrigger = catalog.triggers[0];
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [triggerType, setTriggerType] = useState(initial?.trigger.type ?? firstTrigger?.type ?? "manual");
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(initial?.trigger.config ?? defaultConfigFor(firstTrigger?.fields ?? []));
  const [steps, setSteps] = useState<WorkflowStep[]>(initial?.steps ?? []);
  const [changeNote, setChangeNote] = useState("");
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showDocs, setShowDocs] = useState<Record<string, boolean>>({});

  const trigger = catalog.triggers.find((x) => x.type === triggerType);

  const addStep = (action: string) => {
    const def = catalog.actions.find((a) => a.type === action);
    if (!def) return;
    setSteps((prev) => [...prev, { id: nextStepId(prev, action), action, config: defaultConfigFor(def.fields), onError: "stop" }]);
  };
  const updateStep = (idx: number, patch: Partial<WorkflowStep>) => setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const move = (idx: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  const save = () => {
    const definition = { name, description: description || null, trigger: { type: triggerType, config: triggerConfig }, steps };
    start(async () => {
      const res = await saveWorkflowAction({ id: workflowId, definition, changeNote: changeNote || undefined });
      if (res.ok) {
        setIssues([]);
        if (res.warnings.length) toast.warning(t("savedWithWarnings", { count: res.warnings.length }));
        else toast.success(tc("saved"));
        router.push(`/admin/workflows/${res.id}`);
        router.refresh();
      } else {
        setIssues(res.issues);
        toast.error(t("invalid", { count: res.issues.length }));
      }
    });
  };

  const issueFor = (prefix: string) => issues.filter((i) => i.path.startsWith(prefix));

  return (
    <div className="grid gap-6">
      {issues.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="mb-1 font-medium text-destructive">{t("invalid", { count: issues.length })}</p>
          <ul className="list-disc pl-5 text-destructive/90">
            {issues.map((i, k) => (
              <li key={k}>
                <code className="text-xs">{i.path || "definition"}</code>: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("general")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="wf-name">
              {t("name")} <span className="text-destructive">*</span>
            </Label>
            <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} maxLength={120} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wf-desc">{t("description")}</Label>
            <Textarea id="wf-desc" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t("descriptionPlaceholder")} />
            <p className="text-xs text-muted-foreground">{t("descriptionHint")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("trigger")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>{t("triggerType")}</Label>
            <Select
              value={triggerType}
              onValueChange={(v) => {
                setTriggerType(v);
                setTriggerConfig(defaultConfigFor(catalog.triggers.find((x) => x.type === v)?.fields ?? []));
              }}
            >
              <SelectTrigger className="max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.triggers.map((tr) => (
                  <SelectItem key={tr.type} value={tr.type}>
                    {tr.labels.name[locale]} <span className="text-muted-foreground">· {tr.type}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {trigger && <p className="text-xs text-muted-foreground">{trigger.labels.description[locale]}</p>}
          </div>
          {trigger && <SchemaForm fields={trigger.fields} values={triggerConfig} onChange={setTriggerConfig} catalog={catalog} idPrefix="trigger" />}
          {trigger && Object.keys(trigger.payloadDoc).length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">{t("payloadDoc")}</summary>
              <ul className="mt-2 grid gap-0.5 font-mono">
                {Object.entries(trigger.payloadDoc).map(([k, v]) => (
                  <li key={k}>
                    <span className="text-primary">{`{{ trigger.${k} }}`}</span> <span className="text-muted-foreground">– {v}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {issueFor("trigger").length > 0 && <p className="text-xs text-destructive">{issueFor("trigger").map((i) => i.message).join("; ")}</p>}
        </CardContent>
      </Card>

      <div className="grid gap-3">
        <h2 className="text-base font-semibold">{t("steps")}</h2>
        {steps.length === 0 && <p className="text-sm text-muted-foreground">{t("noSteps")}</p>}
        {steps.map((s, idx) => {
          const def = catalog.actions.find((a) => a.type === s.action);
          const isCollapsed = collapsed[s.id];
          const stepIssues = issueFor(`steps[${idx}]`);
          return (
            <Card key={`${s.id}-${idx}`} className={cn(stepIssues.length && "border-destructive/50")}>
              <CardHeader className="flex flex-row items-center gap-2 space-y-0">
                <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [s.id]: !c[s.id] }))} className="rounded p-1 hover:bg-accent" aria-label="toggle">
                  {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                </button>
                <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{idx + 1}</span>
                <CardTitle className="text-base">
                  {def?.labels.name[locale] ?? s.action} <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{`steps.${s.id}`}</span>
                </CardTitle>
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="up">
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => move(idx, 1)} disabled={idx === steps.length - 1} aria-label="down">
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setSteps((prev) => prev.filter((_, i) => i !== idx))} aria-label={tc("delete")}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardHeader>
              {!isCollapsed && (
                <CardContent className="grid gap-4">
                  {def && <p className="text-xs text-muted-foreground">{def.labels.description[locale]}</p>}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`step-${idx}-id`}>{t("stepId")}</Label>
                      <Input id={`step-${idx}-id`} value={s.id} onChange={(e) => updateStep(idx, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} className="font-mono" />
                      <p className="text-xs text-muted-foreground">{t("stepIdHint")}</p>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`step-${idx}-name`}>{t("stepName")}</Label>
                      <Input id={`step-${idx}-name`} value={s.name ?? ""} onChange={(e) => updateStep(idx, { name: e.target.value })} />
                    </div>
                  </div>
                  {def && <SchemaForm fields={def.fields} values={s.config} onChange={(cfg) => updateStep(idx, { config: cfg })} catalog={catalog} idPrefix={`step-${idx}`} />}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`step-${idx}-cond`}>{t("condition")}</Label>
                      <Input id={`step-${idx}-cond`} value={s.condition ?? ""} onChange={(e) => updateStep(idx, { condition: e.target.value })} placeholder="{{ steps.read.output.wordCount > 100 }}" className="font-mono text-sm" />
                      <p className="text-xs text-muted-foreground">{t("conditionHint")}</p>
                    </div>
                    <div className="grid gap-1.5">
                      <Label>{t("onError")}</Label>
                      <Select value={s.onError ?? "stop"} onValueChange={(v) => updateStep(idx, { onError: v as "stop" | "continue" })}>
                        <SelectTrigger className="max-w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="stop">{t("onErrorStop")}</SelectItem>
                          <SelectItem value="continue">{t("onErrorContinue")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {def && (
                    <details open={showDocs[s.id]} onToggle={(e) => setShowDocs((d) => ({ ...d, [s.id]: (e.target as HTMLDetailsElement).open }))} className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">{t("outputDoc")}</summary>
                      <ul className="mt-2 grid gap-0.5 font-mono">
                        {Object.entries(def.outputDoc).map(([k, v]) => (
                          <li key={k}>
                            <span className="text-primary">{`{{ steps.${s.id}.output.${k} }}`}</span> <span className="text-muted-foreground">– {v}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {stepIssues.length > 0 && (
                    <ul className="text-xs text-destructive">
                      {stepIssues.map((i, k) => (
                        <li key={k}>
                          <code>{i.path}</code>: {i.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("addStep")}:</span>
          {catalog.actions.map((a) => (
            <Button key={a.type} type="button" variant="outline" size="sm" onClick={() => addStep(a.type)}>
              <Plus className="size-4" /> {a.labels.name[locale]}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6">
          {workflowId && (
            <div className="grid gap-1.5">
              <Label htmlFor="wf-note">{t("changeNote")}</Label>
              <Input id="wf-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder={t("changeNotePlaceholder")} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={pending || !name.trim() || steps.length === 0}>
              {workflowId ? t("saveVersion") : t("create")}
            </Button>
            <Button variant="ghost" onClick={() => router.push(workflowId ? `/admin/workflows/${workflowId}` : "/admin/workflows")}>
              {tc("cancel")}
            </Button>
            <p className="ml-auto text-xs text-muted-foreground">{t("saveHint")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
