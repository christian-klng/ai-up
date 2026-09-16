"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { MailCheck } from "lucide-react";
import { registerViaInvite, type AuthFormState } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Registration form inside the invite page's details card; after sending it turns into the inbox hint. */
export function InviteForm({ token, loginHref }: { token: string; loginHref: string }) {
  const t = useTranslations("auth.invite");
  const ta = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(registerViaInvite, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div className="grid gap-2">
        <MailCheck className="size-8 text-primary" aria-hidden />
        <div className="font-medium">{t("sentTitle")}</div>
        <p className="text-sm text-muted-foreground">{t("sentBody", { email: state.email })}</p>
      </div>
    );
  }

  return (
    <div>
      <form action={action} className="grid gap-4">
        <input type="hidden" name="token" value={token} />
        <div className="grid gap-2">
          <Label htmlFor="name">{ta("nameLabel")}</Label>
          <Input id="name" name="name" autoComplete="name" required minLength={2} maxLength={120} />
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
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {t("submit")}
        </Button>
      </form>
      <p className="mt-4 text-sm text-muted-foreground">
        {ta("hasAccount")}{" "}
        <Link href={loginHref} className="font-medium text-foreground underline-offset-4 hover:underline">
          {ta("signIn")}
        </Link>
      </p>
    </div>
  );
}
