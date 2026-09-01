"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { saveAreaAction, type AreaFormState } from "@/server/actions/admin-knowledge";
import { IconPicker } from "@/components/common/icon-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { COLLECTION_LAYOUTS, type CollectionLayout } from "@/lib/collection-layouts";

export type AreaFormValues = { id: string; name: string; purpose: string; description: string | null; icon: string; layout: CollectionLayout };

export function AreaDialog({ mode, area, trigger }: { mode: "create" | "edit"; area?: AreaFormValues; trigger?: React.ReactNode }) {
  const t = useTranslations("admin.knowledge");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [icon, setIcon] = useState(area?.icon ?? "book");
  const [layout, setLayout] = useState<CollectionLayout>(area?.layout ?? "grid");
  const [state, action, pending] = useActionState<AreaFormState, FormData>(saveAreaAction, { status: "idle" });

  useActionFeedback(state, (s) => {
    if (s.status === "saved") {
      toast.success(tc("saved"));
      setOpen(false);
      router.refresh();
    } else if (s.status === "error") {
      toast.error(s.code === "unexpected" ? tc("unexpectedError") : t(`errors.${s.code}`));
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" /> {t("create")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={action} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("create") : t("edit")}</DialogTitle>
            <DialogDescription>{t("dialogIntro")}</DialogDescription>
          </DialogHeader>
          {area && <input type="hidden" name="id" value={area.id} />}
          <input type="hidden" name="icon" value={icon} />
          <input type="hidden" name="layout" value={layout} />

          <div className="grid gap-2">
            <Label htmlFor="area-name">{t("name")}</Label>
            <Input id="area-name" name="name" defaultValue={area?.name ?? ""} required minLength={2} maxLength={80} autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="area-purpose">
              {t("purpose")} <span className="text-destructive">*</span>
            </Label>
            <Textarea id="area-purpose" name="purpose" defaultValue={area?.purpose ?? ""} required minLength={5} maxLength={2000} rows={3} placeholder={t("purposePlaceholder")} />
            <p className="text-xs text-muted-foreground">{t("purposeHint")}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="area-description">{t("description")}</Label>
            <Textarea id="area-description" name="description" defaultValue={area?.description ?? ""} maxLength={2000} rows={2} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="area-icon">{t("icon")}</Label>
            <IconPicker id="area-icon" value={icon} onChange={setIcon} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="area-layout">{t("layout")}</Label>
            <Select value={layout} onValueChange={(v) => setLayout(v as CollectionLayout)}>
              <SelectTrigger id="area-layout">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLLECTION_LAYOUTS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {t(`layouts.${key}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("layoutHint")}</p>
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
