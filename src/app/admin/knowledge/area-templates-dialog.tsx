"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { LayoutTemplate } from "lucide-react";
import { setAreaTemplatesAction } from "@/server/actions/admin-templates";
import { TemplateIcon } from "@/components/structures/template-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type TemplateOption = { id: string; name: string; icon: string; isSystem: boolean };

/** Multi-select of the templates offered in one collection. Empty selection = system templates. */
export function AreaTemplatesDialog({ areaId, areaName, templates, assignedIds }: { areaId: string; areaName: string; templates: TemplateOption[]; assignedIds: string[] }) {
  const t = useTranslations("admin.knowledge");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(assignedIds);
  const [pending, start] = useTransition();

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = () =>
    start(async () => {
      const res = await setAreaTemplatesAction(areaId, selected);
      if (res.ok) {
        toast.success(t("assignSaved"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(tc("unexpectedError"));
      }
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSelected(assignedIds);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("assignTemplates")} title={t("assignTemplates")}>
          <LayoutTemplate className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("assignTemplates")}</DialogTitle>
          <DialogDescription>{t("assignIntro", { name: areaName })}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-80 gap-1.5 overflow-y-auto">
          {templates.map((tpl) => {
            const on = selected.includes(tpl.id);
            return (
              <button
                key={tpl.id}
                type="button"
                aria-pressed={on}
                disabled={pending}
                onClick={() => toggle(tpl.id)}
                className={cn("flex items-center gap-3 rounded-md border p-2.5 text-left text-sm transition-colors hover:bg-accent/60", on && "border-primary bg-primary/5")}
              >
                <input type="checkbox" checked={on} readOnly tabIndex={-1} className="size-4 accent-primary" />
                <TemplateIcon icon={tpl.icon} className={cn("size-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
                <span className="min-w-0 flex-1 truncate font-medium">{tpl.name}</span>
                {tpl.isSystem && <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{t("systemBadge")}</span>}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{t("assignHint")}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
