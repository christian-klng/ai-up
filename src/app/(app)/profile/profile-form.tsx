"use client";

import { useActionState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { Dices, Upload } from "lucide-react";
import { rerollAvatarAction, updateProfileAction, uploadProfilePhotoAction, type ProfileFormState } from "@/server/actions/profile";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = { user: { id: string; name: string; email: string; bio: string | null; locale: "de" | "en"; avatarMediaId: string | null } };

export function ProfileForm({ user }: Props) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rerolling, startReroll] = useTransition();

  const [photoState, photoAction, photoPending] = useActionState<ProfileFormState, FormData>(uploadProfilePhotoAction, { status: "idle" });
  const [formState, formAction, formPending] = useActionState<ProfileFormState, FormData>(updateProfileAction, { status: "idle" });

  useActionFeedback(photoState, (s) => {
    if (s.status === "saved") {
      toast.success(t("updated"));
      router.refresh();
    } else if (s.status === "error") {
      toast.error(s.code === "unexpected" ? tc("unexpectedError") : t(s.code));
    }
  });

  useActionFeedback(formState, (s) => {
    if (s.status === "saved") {
      toast.success(t("updated"));
      router.refresh();
    } else if (s.status === "error") {
      toast.error(tc("unexpectedError"));
    }
  });

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("photo")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-5">
          <UserAvatar user={user} size={96} />
          <div className="grid gap-2">
            <form action={photoAction} className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => e.currentTarget.files?.length && e.currentTarget.form?.requestSubmit()}
              />
              <Button type="button" variant="outline" disabled={photoPending} onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> {t("upload")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={rerolling}
                onClick={() =>
                  startReroll(async () => {
                    await rerollAvatarAction();
                    router.refresh();
                  })
                }
              >
                <Dices className="size-4" /> {t("rerollAvatar")}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">{t("photoHint")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <form action={formAction} className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="name">{tc("name")}</Label>
              <Input id="name" name="name" defaultValue={user.name} required minLength={2} maxLength={120} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">{tc("email")}</Label>
              <Input id="email" value={user.email} disabled readOnly />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bio">{t("bio")}</Label>
              <Textarea id="bio" name="bio" rows={3} maxLength={500} defaultValue={user.bio ?? ""} placeholder={t("bioPlaceholder")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="locale">{t("language")}</Label>
              <Select name="locale" defaultValue={user.locale}>
                <SelectTrigger id="locale" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="de">{tc("german")}</SelectItem>
                  <SelectItem value="en">{tc("english")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Button type="submit" disabled={formPending}>
                {tc("save")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
