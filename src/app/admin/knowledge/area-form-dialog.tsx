"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, Send } from "lucide-react";
import { loadCollectionFormAction, saveCollectionFormAction, type CollectionFormDialogData } from "@/server/actions/admin-forms";
import { FORM_CONTACT_MODES, FORM_DAILY_LIMIT_MAX, FORM_SUCCESS_STYLES, type FormContactMode, type FormSettings, type FormSuccessStyle } from "@/lib/collection-forms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * "External channel" of one collection (docs/externe-formulare.md): switch, template, the fields
 * outsiders may fill in, texts and the message afterwards. Loaded when the dialog opens – the list
 * would otherwise carry every template definition for every collection.
 */
export function AreaFormDialog({ areaId, areaName, open: isOpen }: { areaId: string; areaName: string; open: boolean }) {
  const t = useTranslations("admin.knowledge.form");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CollectionFormDialogData | null>(null);
  const [settings, setSettings] = useState<FormSettings | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  const load = () =>
    startLoading(async () => {
      const res = await loadCollectionFormAction(areaId);
      if (!res) {
        toast.error(tc("unexpectedError"));
        setOpen(false);
        return;
      }
      // First visit: start from the first template the collection offers.
      const first = res.templates[0];
      const initial = res.settings.templateId || !first ? res.settings : { ...res.settings, templateId: first.id, fieldKeys: first.fields.filter((f) => f.allowed).map((f) => f.key) };
      setData(res);
      setSettings(initial);
      setUrl(res.url);
    });

  const patch = (next: Partial<FormSettings>) => setSettings((s) => (s ? { ...s, ...next } : s));
  const template = data?.templates.find((tpl) => tpl.id === settings?.templateId);
  const fillable = template && settings ? template.fields.some((f) => f.allowed && f.answerable && settings.fieldKeys.includes(f.key)) : false;

  const save = () => {
    if (!settings) return;
    startSaving(async () => {
      const res = await saveCollectionFormAction(areaId, settings);
      if (res.ok) {
        setUrl(res.url);
        toast.success(res.enabled ? t("savedOpen") : t("saved"));
        router.refresh();
      } else {
        toast.error(res.code === "noFields" || res.code === "noTemplate" || res.code === "template" ? t(`errors.${res.code}`) : tc("unexpectedError"));
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("open")} title={t("open")} className={isOpen ? "text-emerald-700 dark:text-emerald-400" : undefined}>
          <Send className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("intro", { name: areaName })}</DialogDescription>
        </DialogHeader>

        {loading || !data || !settings ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-6">
            <label className="flex items-start gap-3 rounded-lg border p-3">
              <Switch checked={settings.enabled} onCheckedChange={(enabled) => patch({ enabled })} disabled={!fillable && !settings.enabled} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t("enabled")}</span>
                <span className="block text-xs text-muted-foreground">{fillable || settings.enabled ? t("enabledHint") : t("errors.noFields")}</span>
              </span>
            </label>

            {url && (
              <div className="grid gap-1.5">
                <Label>{t("link")}</Label>
                <div className="flex gap-2">
                  <Input readOnly value={url} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
                  <Button type="button" variant="outline" size="icon" aria-label={tc("copy")} onClick={() => navigator.clipboard.writeText(url).then(() => toast.success(tc("copied")))}>
                    <Copy className="size-4" />
                  </Button>
                  <Button asChild variant="outline" size="icon" aria-label={t("openLink")}>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-4" />
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("submissionCount", { count: data.submissionCount })}</p>
              </div>
            )}

            <section className="grid gap-3">
              <h3 className="text-sm font-medium">{t("fieldsTitle")}</h3>
              <div className="grid gap-1.5">
                <Label>{t("template")}</Label>
                <Select
                  value={settings.templateId ?? ""}
                  onValueChange={(templateId) => {
                    const next = data.templates.find((tpl) => tpl.id === templateId);
                    patch({ templateId, fieldKeys: next ? next.fields.filter((f) => f.allowed).map((f) => f.key) : [] });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("templatePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {data.templates.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {template && (
                <div className="grid gap-1">
                  <p className="text-xs text-muted-foreground">{t("fieldsHint")}</p>
                  {template.fields.map((f) => {
                    const on = f.allowed && settings.fieldKeys.includes(f.key);
                    return (
                      <label key={f.key} className={cn("flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-sm", !f.allowed && "opacity-60", on && "border-primary/60 bg-primary/5")}>
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={on}
                          disabled={!f.allowed}
                          onChange={(e) => patch({ fieldKeys: e.target.checked ? [...settings.fieldKeys, f.key] : settings.fieldKeys.filter((k) => k !== f.key) })}
                        />
                        <span className="min-w-0 flex-1 truncate">{f.label || f.key}</span>
                        {f.required && <span className="text-xs text-muted-foreground">{t("required")}</span>}
                        <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{f.allowed ? f.type : t("internalOnly")}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="grid gap-1.5">
                <Label>{t("contact")}</Label>
                <Select value={settings.contact} onValueChange={(contact) => patch({ contact: contact as FormContactMode })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORM_CONTACT_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(`contactModes.${m}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("contactHint")}</p>
              </div>
            </section>

            <section className="grid gap-3">
              <h3 className="text-sm font-medium">{t("textsTitle")}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="form-heading">{t("heading")}</Label>
                  <Input id="form-heading" maxLength={120} placeholder={areaName} value={settings.texts.title} onChange={(e) => patch({ texts: { ...settings.texts, title: e.target.value } })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="form-title-label">{t("titleLabel")}</Label>
                  <Input id="form-title-label" maxLength={80} placeholder={t("titleLabelPlaceholder")} value={settings.texts.titleLabel} onChange={(e) => patch({ texts: { ...settings.texts, titleLabel: e.target.value } })} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="form-intro">{t("introText")}</Label>
                <Textarea id="form-intro" rows={3} maxLength={2000} value={settings.texts.intro} onChange={(e) => patch({ texts: { ...settings.texts, intro: e.target.value } })} />
              </div>
              <div className="grid gap-1.5 sm:max-w-xs">
                <Label htmlFor="form-submit">{t("submitLabel")}</Label>
                <Input id="form-submit" maxLength={40} placeholder={t("submitLabelPlaceholder")} value={settings.texts.submitLabel} onChange={(e) => patch({ texts: { ...settings.texts, submitLabel: e.target.value } })} />
              </div>
            </section>

            <section className="grid gap-3">
              <h3 className="text-sm font-medium">{t("successTitle")}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>{t("successStyle")}</Label>
                  <Select value={settings.success.style} onValueChange={(style) => patch({ success: { ...settings.success, style: style as FormSuccessStyle } })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORM_SUCCESS_STYLES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(`successStyles.${s}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="form-success-title">{t("successHeading")}</Label>
                  <Input id="form-success-title" maxLength={120} placeholder={t("successHeadingPlaceholder")} value={settings.success.title} onChange={(e) => patch({ success: { ...settings.success, title: e.target.value } })} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="form-success-body">{t("successBody")}</Label>
                <Textarea id="form-success-body" rows={3} maxLength={2000} placeholder={t("successBodyPlaceholder")} value={settings.success.body} onChange={(e) => patch({ success: { ...settings.success, body: e.target.value } })} />
              </div>
              <label className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={settings.success.allowAnother} onChange={(e) => patch({ success: { ...settings.success, allowAnother: e.target.checked } })} />
                {t("allowAnother")}
              </label>
              <div className="grid gap-1.5">
                <Label htmlFor="form-redirect">{t("redirectUrl")}</Label>
                <Input id="form-redirect" type="url" placeholder="https://" value={settings.success.redirectUrl ?? ""} onChange={(e) => patch({ success: { ...settings.success, redirectUrl: e.target.value.trim() || null } })} />
                <p className="text-xs text-muted-foreground">{t("redirectHint")}</p>
              </div>
            </section>

            <section className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="form-daily">{t("dailyLimit")}</Label>
              <Input id="form-daily" type="number" min={1} max={FORM_DAILY_LIMIT_MAX} value={settings.dailyLimit} onChange={(e) => patch({ dailyLimit: Math.max(1, Math.min(FORM_DAILY_LIMIT_MAX, Math.round(Number(e.target.value) || 1))) })} />
              <p className="text-xs text-muted-foreground">{t("dailyLimitHint")}</p>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("close")}
          </Button>
          <Button type="button" onClick={save} disabled={saving || loading || !settings}>
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
