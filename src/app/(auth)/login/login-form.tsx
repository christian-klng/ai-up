"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { MailCheck } from "lucide-react";
import { requestMagicLink, type AuthFormState } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function LoginForm({ next, error }: { next?: string; error?: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(requestMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <Card>
        <CardHeader>
          <MailCheck className="size-8 text-primary" aria-hidden />
          <CardTitle>{t("linkSentTitle")}</CardTitle>
          <CardDescription>{t("linkSentBody", { email: state.email })}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("loginTitle")}</CardTitle>
        <CardDescription>{t("loginIntro")}</CardDescription>
      </CardHeader>
      <CardContent>
        {error === "invalid_link" && (
          <Alert className="mb-4">
            <AlertTitle>{t("invalidLinkTitle")}</AlertTitle>
            <AlertDescription>{t("invalidLinkBody")}</AlertDescription>
          </Alert>
        )}
        <form action={action} className="grid gap-4">
          <input type="hidden" name="next" value={next ?? "/"} />
          <div className="grid gap-2">
            <Label htmlFor="email">{t("emailLabel")}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required autoFocus placeholder="name@example.com" />
          </div>
          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {t(`errors.${state.code === "unexpected" ? "tooManyRequests" : state.code}` as never)}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {t("sendLink")}
          </Button>
        </form>
        <p className="mt-6 text-sm text-muted-foreground">
          {t("noAccount")}{" "}
          <Link href="/register" className="font-medium text-foreground underline-offset-4 hover:underline">
            {t("register")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
