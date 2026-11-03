"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MailCheck } from "lucide-react";
import { createCommunityAction, type CreateCommunityState } from "@/server/actions/communities";
import { slugifyCommunityName } from "@/lib/community";
import { COMMUNITY_TERMS_PATH } from "@/lib/community-creation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * The slug is filled from the name while nobody has touched it, because it doubles as the
 * sub-domain label later (docs/communities.md §7) and most founders should not have to think
 * about it at all.
 */
export function CreateCommunityForm({ visitor, defaultLocale, defaultColor }: { visitor: boolean; defaultLocale: "de" | "en"; defaultColor: string }) {
  const t = useTranslations("communities.create");
  const tc = useTranslations("common");
  const [state, action, pending] = useActionState<CreateCommunityState, FormData>(createCommunityAction, { status: "idle" });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [color, setColor] = useState(defaultColor);

  useEffect(() => {
    // A real page load: the shell has to come up in the new community.
    if (state.status === "created") window.location.assign(state.href);
  }, [state]);

  const effectiveSlug = slugTouched ? slug : slugifyCommunityName(name);

  if (state.status === "sent") {
    return (
      <Card>
        <CardContent className="grid gap-2">
          <MailCheck className="size-8 text-primary" aria-hidden />
          <div className="font-medium">{t("sentTitle")}</div>
          <p className="text-sm text-muted-foreground">{t("sentBody", { email: state.email })}</p>
        </CardContent>
      </Card>
    );
  }

  const errorText = state.status === "error" ? (state.code === "unexpected" ? tc("unexpectedError") : t(`errors.${state.code}`)) : null;

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
            <Label htmlFor="tagline">{t("taglineLabel")}</Label>
            <Input id="tagline" name="tagline" maxLength={160} placeholder={t("taglinePlaceholder")} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="purpose">{t("purposeLabel")}</Label>
            <Textarea id="purpose" name="purpose" required minLength={5} maxLength={4000} rows={4} placeholder={t("purposePlaceholder")} />
            <p className="text-xs text-muted-foreground">{t("purposeHelp")}</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="locale">{t("localeLabel")}</Label>
              <Select name="locale" defaultValue={defaultLocale}>
                <SelectTrigger id="locale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="de">{tc("german")}</SelectItem>
                  <SelectItem value="en">{tc("english")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="primaryColor">{t("colorLabel")}</Label>
              <div className="flex items-center gap-2">
                <input
                  id="primaryColor"
                  name="primaryColor"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
                />
                <code className="text-sm text-muted-foreground">{color}</code>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div className="grid gap-1">
              <Label htmlFor="joinLink">{t("joinLinkLabel")}</Label>
              <p className="text-xs text-muted-foreground">{t("joinLinkHelp")}</p>
            </div>
            <Switch id="joinLink" name="joinLink" />
          </div>

          {visitor && (
            <div className="grid gap-5 border-t pt-5 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="founderName">{t("founderNameLabel")}</Label>
                <Input id="founderName" name="founderName" autoComplete="name" required minLength={2} maxLength={120} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="founderEmail">{t("founderEmailLabel")}</Label>
                <Input id="founderEmail" name="founderEmail" type="email" autoComplete="email" required placeholder="name@example.com" />
              </div>
              {/* Hidden from people, tempting for scripts; see createCommunityAction. */}
              <div className="absolute -left-[9999px]" aria-hidden>
                <label htmlFor="website">Website</label>
                <input id="website" name="website" tabIndex={-1} autoComplete="off" />
              </div>
            </div>
          )}

          <div className="flex items-start gap-2">
            <Checkbox id="terms" name="terms" required className="mt-0.5" />
            <Label htmlFor="terms" className="block font-normal leading-snug">
              {t("termsBefore")}{" "}
              <Link href={COMMUNITY_TERMS_PATH} target="_blank" className="font-medium underline underline-offset-4">
                {t("termsLink")}
              </Link>{" "}
              {t("termsBetween")}{" "}
              <Link href="/privacy" target="_blank" className="font-medium underline underline-offset-4">
                {t("privacyLink")}
              </Link>
              {t("termsAfter")}
            </Label>
          </div>

          {errorText && (
            <p className="text-sm text-destructive" role="alert">
              {errorText}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {visitor ? t("submitVisitor") : t("submit")}
            </Button>
            <Button asChild variant="ghost">
              <Link href={visitor ? "/" : "/home"}>{tc("cancel")}</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
