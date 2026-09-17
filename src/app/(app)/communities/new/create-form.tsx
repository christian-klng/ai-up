"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createCommunityAction, type CreateCommunityState } from "@/server/actions/communities";
import { slugifyCommunityName } from "@/lib/community";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * The slug is filled from the name while nobody has touched it, because it doubles as the
 * sub-domain label later (docs/communities.md §7) and most founders should not have to think
 * about it at all.
 */
export function CreateCommunityForm({ defaultLocale }: { defaultLocale: "de" | "en" }) {
  const t = useTranslations("communities.create");
  const tc = useTranslations("common");
  const router = useRouter();
  const [state, action, pending] = useActionState<CreateCommunityState, FormData>(createCommunityAction, { status: "idle" });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (state.status === "created") router.push("/admin/general");
  }, [state, router]);

  const effectiveSlug = slugTouched ? slug : slugifyCommunityName(name);

  return (
    <Card>
      <CardContent>
        <form action={action} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="name">{t("nameLabel")}</Label>
            <Input id="name" name="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="slug">{t("slugLabel")}</Label>
            <Input
              id="slug"
              name="slug"
              required
              minLength={3}
              maxLength={40}
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              placeholder="lesekreis"
            />
            <p className="text-xs text-muted-foreground">{t("slugHelp")}</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="purpose">{t("purposeLabel")}</Label>
            <Textarea id="purpose" name="purpose" required minLength={5} maxLength={4000} rows={4} placeholder={t("purposePlaceholder")} />
            <p className="text-xs text-muted-foreground">{t("purposeHelp")}</p>
          </div>

          <input type="hidden" name="locale" value={defaultLocale} />

          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.code === "slugTaken" ? t("errorSlugTaken") : state.code === "slugInvalid" ? t("errorSlugInvalid") : state.code === "notAllowed" ? t("errorNotAllowed") : tc("unexpectedError")}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {t("submit")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
              {tc("cancel")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
