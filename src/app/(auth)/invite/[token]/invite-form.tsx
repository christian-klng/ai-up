"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, MailCheck } from "lucide-react";
import { registerViaInvite, type AuthFormState } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function InviteForm({ token, appName, meetingTitle, spaceName, startsAt, loginHref }: { token: string; appName: string; meetingTitle: string; spaceName: string; startsAt: string | null; loginHref: string }) {
  const t = useTranslations("auth.invite");
  const ta = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(registerViaInvite, { status: "idle" });

  if (state.status === "sent") {
    return (
      <Card>
        <CardHeader>
          <MailCheck className="size-8 text-primary" aria-hidden />
          <CardTitle>{t("sentTitle")}</CardTitle>
          <CardDescription>{t("sentBody", { email: state.email })}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title", { app: appName })}</CardTitle>
        <CardDescription>{t("intro")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-5 rounded-md border bg-muted/40 p-3">
          <div className="font-medium">{meetingTitle}</div>
          <div className="text-sm text-muted-foreground">{spaceName}</div>
          {startsAt && (
            <div className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarClock className="size-4" aria-hidden /> {startsAt}
            </div>
          )}
        </div>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="token" value={token} />
          <div className="grid gap-2">
            <Label htmlFor="name">{ta("nameLabel")}</Label>
            <Input id="name" name="name" autoComplete="name" required minLength={2} maxLength={120} autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">{ta("emailLabel")}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required placeholder="name@example.com" />
          </div>
          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.code === "invalidInvite" ? t("invalidBody") : ta(`errors.${state.code === "unexpected" ? "tooManyRequests" : state.code}` as never)}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {t("submit")}
          </Button>
        </form>
        <p className="mt-6 text-sm text-muted-foreground">
          {ta("hasAccount")}{" "}
          <Link href={loginHref} className="font-medium text-foreground underline-offset-4 hover:underline">
            {ta("signIn")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
