"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil, RefreshCw, Star, Trash2, FlaskConical } from "lucide-react";
import type { LlmModelInfo } from "@/server/db/schema";
import { addManualModelsAction, deleteProviderAction, setDefaultProviderAction, setEnabledModelsAction, syncModelsAction, testProviderAction } from "@/server/actions/admin-llm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProviderDialog, type Preset } from "./provider-dialog";
import { cn } from "@/lib/utils";

type P = {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  apiKeyMasked: string | null;
  hasApiKey: boolean;
  extraHeaders: Record<string, string>;
  availableModels: LlmModelInfo[];
  enabledModels: string[];
  defaultModel: string | null;
  isDefault: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export function ProviderCard({ provider, presets }: { provider: P; presets: Preset[] }) {
  const t = useTranslations("admin.llm");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState("");
  const [enabled, setEnabled] = useState<string[]>(provider.enabledModels);
  const [defaultModel, setDefaultModel] = useState<string | null>(provider.defaultModel);
  const [manual, setManual] = useState("");
  const [testPrompt, setTestPrompt] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const models = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = provider.availableModels.filter((m) => !q || m.id.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q));
    // enabled first
    return [...list].sort((a, b) => Number(enabled.includes(b.id)) - Number(enabled.includes(a.id)) || a.id.localeCompare(b.id));
  }, [provider.availableModels, filter, enabled]);
  const shown = showAll ? models : models.slice(0, 40);
  const dirty = JSON.stringify(enabled) !== JSON.stringify(provider.enabledModels) || defaultModel !== provider.defaultModel;

  const toggle = (id: string) => {
    setEnabled((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (defaultModel && !next.includes(defaultModel)) setDefaultModel(next[0] ?? null);
      if (!defaultModel && next.length) setDefaultModel(next[0]);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
        <CardTitle className="text-base">{provider.name}</CardTitle>
        <Badge variant="secondary">{presets.find((p) => p.kind === provider.kind)?.label ?? provider.kind}</Badge>
        {provider.isDefault && <Badge>{t("default")}</Badge>}
        <span className="truncate font-mono text-xs text-muted-foreground">{provider.baseUrl}</span>
        <div className="ml-auto flex items-center gap-1">
          {!provider.isDefault && (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { await setDefaultProviderAction(provider.id); router.refresh(); })}>
              <Star className="size-4" /> {t("makeDefault")}
            </Button>
          )}
          <ProviderDialog
            mode="edit"
            presets={presets}
            provider={{ id: provider.id, name: provider.name, kind: provider.kind, baseUrl: provider.baseUrl, hasApiKey: provider.hasApiKey, apiKeyMasked: provider.apiKeyMasked, extraHeaders: provider.extraHeaders }}
            trigger={
              <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                <Pencil className="size-4" />
              </Button>
            }
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={tc("delete")}
            disabled={pending}
            onClick={() => {
              if (!confirm(t("confirmDelete", { name: provider.name }))) return;
              start(async () => {
                await deleteProviderAction(provider.id);
                router.refresh();
              });
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{provider.hasApiKey ? t("keySet", { masked: provider.apiKeyMasked ?? "" }) : t("keyMissing")}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{t("modelCount", { available: provider.availableModels.length, enabled: provider.enabledModels.length })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await syncModelsAction(provider.id);
                if (res.ok) toast.success(t("synced", { count: res.count }));
                else toast.error(res.error);
                router.refresh();
              })
            }
          >
            <RefreshCw className={cn("size-4", pending && "animate-spin")} /> {t("loadModels")}
          </Button>
          {provider.lastError && <span className="text-xs text-destructive">{provider.lastError}</span>}
        </div>

        {provider.availableModels.length > 0 && (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("filterModels")} className="max-w-xs" />
              <span className="text-xs text-muted-foreground">{t("enableHint")}</span>
              {dirty && (
                <Button size="sm" disabled={pending} onClick={() => start(async () => { await setEnabledModelsAction(provider.id, enabled, defaultModel); toast.success(tc("saved")); router.refresh(); })} className="ml-auto">
                  {t("saveModels")}
                </Button>
              )}
            </div>
            <ul className="grid max-h-80 gap-0.5 overflow-y-auto rounded-md border p-1">
              {shown.map((m) => {
                const on = enabled.includes(m.id);
                return (
                  <li key={m.id} className={cn("flex items-center gap-2 rounded px-2 py-1 text-sm", on && "bg-primary/5")}>
                    <input type="checkbox" checked={on} onChange={() => toggle(m.id)} className="size-4 accent-primary" aria-label={m.id} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-mono text-xs">{m.id}</span>
                      {m.name && m.name !== m.id && <span className="ml-1 text-xs text-muted-foreground">{m.name}</span>}
                    </span>
                    {m.contextLength ? <span className="text-[11px] text-muted-foreground">{Math.round(m.contextLength / 1000)}k</span> : null}
                    {m.supportedParameters?.includes("reasoning") && <Badge variant="outline" className="text-[10px]">reasoning</Badge>}
                    {(m.supportedParameters?.includes("structured_outputs") || m.supportedParameters?.includes("response_format")) && <Badge variant="outline" className="text-[10px]">json</Badge>}
                    {on && (
                      <button type="button" onClick={() => setDefaultModel(m.id)} className={cn("rounded px-1.5 text-[11px]", defaultModel === m.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
                        {t("default")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {models.length > shown.length && (
              <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                {t("showAll", { count: models.length })}
              </Button>
            )}
          </div>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t("manualModels")}</summary>
          <div className="mt-2 flex gap-2">
            <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="gpt-4o-mini, llama-3.3-70b" className="font-mono text-xs" />
            <Button variant="outline" size="sm" disabled={pending || !manual.trim()} onClick={() => start(async () => { await addManualModelsAction(provider.id, manual); setManual(""); router.refresh(); })}>
              {t("addModels")}
            </Button>
          </div>
        </details>

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t("test")}</summary>
          <div className="mt-2 grid gap-2">
            <Textarea value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} rows={2} placeholder={t("testPlaceholder")} />
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={pending || !(defaultModel ?? enabled[0])}
                onClick={() =>
                  start(async () => {
                    setTestResult(null);
                    const res = await testProviderAction(provider.id, defaultModel ?? enabled[0]!, testPrompt);
                    setTestResult(res.ok ? `${res.model} · ${res.ms} ms\n\n${res.text}` : `Error: ${res.error}`);
                  })
                }
              >
                <FlaskConical className="size-4" /> {t("runTest", { model: defaultModel ?? enabled[0] ?? "–" })}
              </Button>
            </div>
            {testResult && <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">{testResult}</pre>}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
