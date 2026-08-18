"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { register, type AuthFormState } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function RegisterForm() {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(register, { status: "idle" });

  if (state.status === "registered") {
    return (
      <Card>
        <CardHeader>
          <CheckCircle2 className="size-8 text-primary" aria-hidden />
          <CardTitle>{t("registeredTitle")}</CardTitle>
          <CardDescription>{t("registeredBody")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("registerTitle")}</CardTitle>
        <CardDescription>{t("registerIntro")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">{t("nameLabel")}</Label>
            <Input id="name" name="name" autoComplete="name" required minLength={2} maxLength={120} autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">{t("emailLabel")}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required placeholder="name@example.com" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="message">{t("messageLabel")}</Label>
            <Textarea id="message" name="message" rows={3} maxLength={1000} placeholder={t("messagePlaceholder")} />
          </div>
          {state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.code === "unexpected" ? t("errors.tooManyRequests") : t(`errors.${state.code}` as never)}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {t("registerSubmit")}
          </Button>
        </form>
        <p className="mt-6 text-sm text-muted-foreground">
          {t("hasAccount")}{" "}
          <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            {t("signIn")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
