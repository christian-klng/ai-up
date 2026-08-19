"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, KeyRound, Plus } from "lucide-react";
import { createApiKeyAction } from "@/server/actions/admin-api-keys";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function CreateKeyDialog({ scopes }: { scopes: string[] }) {
  const t = useTranslations("admin.apiKeys");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>(scopes);
  const [days, setDays] = useState(0);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setName("");
    setSelected(scopes);
    setDays(0);
    setPlaintext(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          reset();
          router.refresh();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> {t("create")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("create")}</DialogTitle>
          <DialogDescription>{plaintext ? t("createdIntro") : t("dialogIntro")}</DialogDescription>
        </DialogHeader>
        {plaintext ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
              <KeyRound className="size-4 shrink-0 text-primary" />
              <code className="min-w-0 flex-1 break-all text-xs">{plaintext}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(plaintext);
                  toast.success(t("copied"));
                }}
              >
                <Copy className="size-4" /> {t("copy")}
              </Button>
            </div>
            <p className="text-xs text-destructive">{t("onlyOnce")}</p>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>{tc("close")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await createApiKeyAction({ name, scopes: selected, expiresInDays: days });
                if (res.ok) setPlaintext(res.plaintext);
                else toast.error(res.error);
              });
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="key-name">{t("name")}</Label>
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} placeholder="Claude Code – Laptop" autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("scopes")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {scopes.map((s) => {
                  const on = selected.includes(s);
                  return (
                    <button key={s} type="button" aria-pressed={on} onClick={() => setSelected(on ? selected.filter((x) => x !== s) : [...selected, s])} className={cn("rounded-full border px-3 py-1 font-mono text-xs", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="key-days">{t("expiresInDays")}</Label>
              <Input id="key-days" type="number" min={0} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} className="max-w-40" />
              <p className="text-xs text-muted-foreground">{t("expiresHint")}</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={pending || !name.trim() || selected.length === 0}>
                {t("create")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
