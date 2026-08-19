"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { saveGeneralSettingsAction, type AdminFormState } from "@/server/actions/admin-settings";
import type { ThemeSettings } from "@/server/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

const PRESETS = ["#2563eb", "#0f766e", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0f172a", "#b45309"];

type Props = { settings: { name: string; tagline: string | null; botName: string; theme: ThemeSettings; defaultLocale: "de" | "en" } };

export function GeneralSettingsForm({ settings }: Props) {
  const t = useTranslations("admin.general");
  const tc = useTranslations("common");
  const router = useRouter();
  const [color, setColor] = useState(settings.theme.primaryColor);
  const [radius, setRadius] = useState(settings.theme.radius);
  const [state, action, pending] = useActionState<AdminFormState, FormData>(saveGeneralSettingsAction, { status: "idle" });

  useActionFeedback(state, (s) => {
    if (s.status === "saved") {
      toast.success(tc("saved"));
      router.refresh();
    } else if (s.status === "error") toast.error(s.message ?? tc("unexpectedError"));
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={action} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="name">{t("name")}</Label>
            <Input id="name" name="name" defaultValue={settings.name} required maxLength={80} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tagline">{t("tagline")}</Label>
            <Input id="tagline" name="tagline" defaultValue={settings.tagline ?? ""} maxLength={160} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="botName">{t("botName")}</Label>
            <Input id="botName" name="botName" defaultValue={settings.botName} required maxLength={60} />
            <p className="text-xs text-muted-foreground">{t("botNameHint")}</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="primaryColor">{t("primaryColor")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="primaryColor"
                name="primaryColor"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
              />
              <code className="text-sm text-muted-foreground">{color}</code>
              <div className="ml-2 flex gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-label={p}
                    onClick={() => setColor(p)}
                    className="size-6 rounded-full border ring-offset-background transition-transform hover:scale-110 data-[active=true]:ring-2 data-[active=true]:ring-ring data-[active=true]:ring-offset-2"
                    style={{ backgroundColor: p }}
                    data-active={p === color}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="radius">
              {t("radius")} <span className="text-muted-foreground">({radius.toFixed(2)}rem)</span>
            </Label>
            <input id="radius" name="radius" type="range" min={0} max={1.25} step={0.05} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-64 accent-[var(--primary)]" />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="mode">{t("mode")}</Label>
              <Select name="mode" defaultValue={settings.theme.mode}>
                <SelectTrigger id="mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">{t("modeSystem")}</SelectItem>
                  <SelectItem value="light">{t("modeLight")}</SelectItem>
                  <SelectItem value="dark">{t("modeDark")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="defaultLocale">{t("defaultLocale")}</Label>
              <Select name="defaultLocale" defaultValue={settings.defaultLocale}>
                <SelectTrigger id="defaultLocale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="de">{tc("german")}</SelectItem>
                  <SelectItem value="en">{tc("english")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border p-4" style={{ borderRadius: `${radius}rem` }}>
            <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{t("preview")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-9 items-center px-4 text-sm font-medium text-white" style={{ backgroundColor: color, borderRadius: `${radius * 0.8}rem` }}>
                {tc("save")}
              </span>
              <span className="inline-flex h-9 items-center border px-4 text-sm" style={{ borderRadius: `${radius * 0.8}rem`, borderColor: color, color }}>
                {tc("cancel")}
              </span>
            </div>
          </div>

          <div>
            <Button type="submit" disabled={pending}>
              {tc("save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
