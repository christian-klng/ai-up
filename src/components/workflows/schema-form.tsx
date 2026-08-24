"use client";

import { useLocale, useTranslations } from "next-intl";
import type { FieldSpec } from "@/server/workflows/types";
import type { EditorCatalog } from "@/server/workflows/catalog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Loc = "de" | "en";
type Values = Record<string, unknown>;

const CONTENT_TYPES = ["markdown", "image", "video", "link", "structured"] as const;

/**
 * Renders a list of FieldSpecs (from the trigger/action registry) as form controls.
 * Values are kept as a plain object; templates are free text.
 */
export function SchemaForm({ fields, values, onChange, catalog, idPrefix }: { fields: FieldSpec[]; values: Values; onChange: (next: Values) => void; catalog: EditorCatalog; idPrefix: string }) {
  const locale = useLocale() as Loc;
  const t = useTranslations("workflows.editor");
  const tk = useTranslations("knowledge.types");
  const set = (key: string, v: unknown) => onChange({ ...values, [key]: v });

  return (
    <div className="grid gap-4">
      {fields.map((f) => {
        if (f.showIf && values[f.showIf.key] !== f.showIf.equals) return null;
        const id = `${idPrefix}-${f.key}`;
        const label = (
          <Label htmlFor={id}>
            {f.label[locale]} {f.required && <span className="text-destructive">*</span>}
          </Label>
        );
        const help = f.help && <p className="text-xs text-muted-foreground">{f.help[locale]}</p>;
        const v = values[f.key];
        switch (f.type) {
          case "text":
          case "cron":
            return (
              <div key={f.key} className="grid gap-1.5">
                {label}
                <Input id={id} value={(v as string) ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} className={cn(f.type === "cron" && "font-mono")} />
                {help}
              </div>
            );
          case "textarea":
          case "template":
            return (
              <div key={f.key} className="grid gap-1.5">
                {label}
                <Textarea id={id} value={(v as string) ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} rows={f.type === "template" && f.key.toLowerCase().includes("prompt") ? 6 : 3} className="font-mono text-sm" />
                {help}
              </div>
            );
          case "json":
            return (
              <div key={f.key} className="grid gap-1.5">
                {label}
                <Textarea id={id} value={typeof v === "string" ? v : v ? JSON.stringify(v, null, 2) : ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} rows={5} className="font-mono text-xs" />
                {help}
              </div>
            );
          case "number":
            return (
              <div key={f.key} className="grid gap-1.5">
                {label}
                <Input id={id} type="number" value={v === undefined || v === null || v === "" ? "" : String(v)} min={f.min} max={f.max} step={f.step ?? 1} onChange={(e) => set(f.key, e.target.value === "" ? undefined : Number(e.target.value))} placeholder={f.placeholder} className="max-w-48" />
                {help}
              </div>
            );
          case "boolean":
            return (
              <div key={f.key} className="flex items-start gap-3">
                <Switch id={id} checked={!!v} onCheckedChange={(c) => set(f.key, c)} />
                <div className="grid gap-0.5">
                  {label}
                  {help}
                </div>
              </div>
            );
          case "select":
            return (
              <div key={f.key} className="grid gap-1.5">
                {label}
                <Select value={(v as string) ?? ""} onValueChange={(val) => set(f.key, val)}>
                  <SelectTrigger id={id} className="max-w-72">
                    <SelectValue placeholder="–" />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options?.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label[locale]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {help}
              </div>
            );
          case "content-types": {
            const arr = (v as string[]) ?? [];
            return (
              <div key={f.key} className="grid gap-1.5">
                {label}
                <div className="flex flex-wrap gap-1.5">
                  {CONTENT_TYPES.map((ct) => {
                    const active = arr.includes(ct);
                    return (
                      <button key={ct} type="button" aria-pressed={active} onClick={() => set(f.key, active ? arr.filter((x) => x !== ct) : [...arr, ct])} className={cn("rounded-full border px-3 py-1 text-sm", active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
                        {tk(ct)}
                      </button>
                    );
                  })}
                </div>
                {help}
              </div>
            );
          }
          case "area": {
            const multi = Array.isArray(v) || f.key.endsWith("Ids");
            if (multi) {
              const arr = (v as string[]) ?? [];
              return (
                <div key={f.key} className="grid gap-1.5">
                  {label}
                  <div className="flex flex-wrap gap-1.5">
                    {catalog.areas.map((a) => {
                      const active = arr.includes(a.id);
                      return (
                        <button key={a.id} type="button" aria-pressed={active} onClick={() => set(f.key, active ? arr.filter((x) => x !== a.id) : [...arr, a.id])} className={cn("rounded-full border px-3 py-1 text-sm", active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
                          {a.name}
                        </button>
                      );
                    })}
                    {catalog.areas.length === 0 && <span className="text-xs text-muted-foreground">{t("noAreas")}</span>}
                  </div>
                  {help}
                </div>
              );
            }
            return (
              <div key={f.key} className="grid gap-1.5">
                {label}
                <Select value={(v as string) ?? ""} onValueChange={(val) => set(f.key, val)}>
                  <SelectTrigger id={id} className="max-w-72">
                    <SelectValue placeholder="–" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.areas.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {help}
              </div>
            );
          }
          case "llm-model": {
            const providerId = (values.providerId as string) ?? "default";
            const model = (values.model as string) ?? "default";
            const provider = catalog.providers.find((p) => p.id === providerId) ?? catalog.providers.find((p) => p.isDefault) ?? catalog.providers[0];
            return (
              <div key={f.key} className="grid gap-1.5">
                {label}
                {catalog.providers.length === 0 ? (
                  <p className="text-sm text-destructive">{t("noProviders")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Select value={providerId} onValueChange={(val) => onChange({ ...values, providerId: val, model: "default" })}>
                      <SelectTrigger className="w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">{t("defaultProvider")}</SelectItem>
                        {catalog.providers.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={model} onValueChange={(val) => set("model", val)}>
                      <SelectTrigger className="w-72">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">{t("defaultModel", { model: provider?.defaultModel ?? "–" })}</SelectItem>
                        {provider?.models.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name ? `${m.name} (${m.id})` : m.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {help}
              </div>
            );
          }
          case "audience": {
            const a = (v as { type?: string; userIds?: string[] }) ?? { type: "triggerUser", userIds: [] };
            const opts = [
              { value: "triggerUser", label: t("audience.triggerUser") },
              { value: "admins", label: t("audience.admins") },
              { value: "all", label: t("audience.all") },
              { value: "users", label: t("audience.users") },
            ];
            return (
              <div key={f.key} className="grid gap-1.5">
                {label}
                <Select value={a.type ?? "triggerUser"} onValueChange={(val) => set(f.key, { ...a, type: val })}>
                  <SelectTrigger className="max-w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {opts.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {a.type === "users" && (
                  <div className="flex flex-wrap gap-1.5">
                    {catalog.members.map((m) => {
                      const active = (a.userIds ?? []).includes(m.id);
                      return (
                        <button key={m.id} type="button" aria-pressed={active} onClick={() => set(f.key, { ...a, userIds: active ? (a.userIds ?? []).filter((x) => x !== m.id) : [...(a.userIds ?? []), m.id] })} className={cn("rounded-full border px-3 py-1 text-sm", active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {help}
              </div>
            );
          }
          case "question-key": {
            const opts = catalog.questionKeys;
            return (
              <div key={f.key} className="grid gap-1.5">
                {label}
                <div className="flex flex-wrap gap-2">
                  <Select value={(v as string) || "__any__"} onValueChange={(val) => set(f.key, val === "__any__" ? "" : val)}>
                    <SelectTrigger id={id} className="w-72">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any__">{t("anyQuestion")}</SelectItem>
                      {opts.map((o) => (
                        <SelectItem key={o.key} value={o.key}>
                          {o.key} <span className="text-muted-foreground">· {o.title}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input value={(v as string) ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={t("questionKeyManual")} className="w-56 font-mono text-sm" />
                </div>
                {help}
              </div>
            );
          }
          case "multiselect":
            return null;
          default:
            return null;
        }
      })}
    </div>
  );
}
