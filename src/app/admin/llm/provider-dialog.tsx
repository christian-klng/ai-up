"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { saveProviderAction, type ProviderFormState } from "@/server/actions/admin-llm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type Preset = { kind: string; label: string; baseUrl: string; hint: string };
export type ProviderFormValues = { id: string; name: string; kind: string; baseUrl: string; hasApiKey: boolean; apiKeyMasked: string | null; extraHeaders: Record<string, string> };

export function ProviderDialog({ mode, provider, presets, trigger }: { mode: "create" | "edit"; provider?: ProviderFormValues; presets: Preset[]; trigger?: React.ReactNode }) {
  const t = useTranslations("admin.llm");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(provider?.kind ?? "openrouter");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? presets.find((p) => p.kind === "openrouter")?.baseUrl ?? "");
  const [state, action, pending] = useActionState<ProviderFormState, FormData>(saveProviderAction, { status: "idle" });
  useActionFeedback(state, (s) => {
    if (s.status === "saved") {
      toast.success(tc("saved"));
      setOpen(false);
      router.refresh();
    } else if (s.status === "error") toast.error(s.message);
  });
  const preset = presets.find((p) => p.kind === kind);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" /> {t("add")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={action} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("add") : t("edit")}</DialogTitle>
            <DialogDescription>{t("dialogIntro")}</DialogDescription>
          </DialogHeader>
          {provider && <input type="hidden" name="id" value={provider.id} />}
          <input type="hidden" name="kind" value={kind} />
          <div className="grid gap-1.5">
            <Label>{t("kind")}</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v);
                const p = presets.find((x) => x.kind === v);
                if (p?.baseUrl) setBaseUrl(p.baseUrl);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.kind} value={p.kind}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {preset && <p className="text-xs text-muted-foreground">{preset.hint}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-name">{t("name")}</Label>
            <Input id="p-name" name="name" defaultValue={provider?.name ?? preset?.label ?? ""} required minLength={2} maxLength={80} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-url">{t("baseUrl")}</Label>
            <Input id="p-url" name="baseUrl" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required placeholder="https://…/v1" className="font-mono text-sm" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-key">{t("apiKey")}</Label>
            <Input id="p-key" name="apiKey" type="password" autoComplete="off" defaultValue={provider?.hasApiKey ? "__keep__" : ""} placeholder={provider?.hasApiKey ? t("apiKeyKeep", { masked: provider.apiKeyMasked ?? "" }) : "sk-…"} className="font-mono text-sm" />
            <p className="text-xs text-muted-foreground">{t("apiKeyHint")}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-headers">{t("extraHeaders")}</Label>
            <Textarea id="p-headers" name="extraHeaders" defaultValue={provider && Object.keys(provider.extraHeaders).length ? JSON.stringify(provider.extraHeaders, null, 2) : ""} rows={2} placeholder='{"X-Custom": "value"}' className="font-mono text-xs" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
