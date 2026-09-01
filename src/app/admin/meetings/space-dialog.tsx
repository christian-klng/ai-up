"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { saveSpaceAction, type SpaceFormState } from "@/server/actions/admin-meetings";
import { IconPicker } from "@/components/common/icon-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export type SpaceFormValues = { id: string; name: string; purpose: string; description: string | null; icon: string; recordingDefault: boolean };

export function SpaceDialog({ mode, space, trigger }: { mode: "create" | "edit"; space?: SpaceFormValues; trigger?: React.ReactNode }) {
  const t = useTranslations("admin.meetings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [icon, setIcon] = useState(space?.icon ?? "calendar");
  const [state, action, pending] = useActionState<SpaceFormState, FormData>(saveSpaceAction, { status: "idle" });

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
          {space && <input type="hidden" name="id" value={space.id} />}
          <input type="hidden" name="icon" value={icon} />

          <div className="grid gap-2">
            <Label htmlFor="space-name">{t("name")}</Label>
            <Input id="space-name" name="name" defaultValue={space?.name ?? ""} required minLength={2} maxLength={80} autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="space-purpose">
              {t("purpose")} <span className="text-destructive">*</span>
            </Label>
            <Textarea id="space-purpose" name="purpose" defaultValue={space?.purpose ?? ""} required minLength={5} maxLength={2000} rows={3} placeholder={t("purposePlaceholder")} />
            <p className="text-xs text-muted-foreground">{t("purposeHint")}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="space-description">{t("description")}</Label>
            <Textarea id="space-description" name="description" defaultValue={space?.description ?? ""} maxLength={2000} rows={2} />
          </div>
          <div className="flex items-start gap-3">
            <Switch id="space-recording" name="recordingDefault" defaultChecked={space?.recordingDefault ?? true} />
            <div className="grid gap-0.5">
              <Label htmlFor="space-recording">{t("recordingDefault")}</Label>
              <p className="text-xs text-muted-foreground">{t("recordingDefaultHint")}</p>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="space-icon">{t("icon")}</Label>
            <IconPicker id="space-icon" value={icon} onChange={setIcon} />
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
