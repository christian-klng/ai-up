"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { confirmCommunityRequestAction, type ConfirmCommunityState } from "@/server/actions/communities";
import { MAX_FOUNDED_COMMUNITIES } from "@/lib/community-creation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The short name can only be edited here when someone else claimed it after the form was sent. */
export function ConfirmCommunityForm({ token, slug, slugTaken }: { token: string; slug: string; slugTaken: boolean }) {
  const t = useTranslations("communities.confirm");
  const tc = useTranslations("common");
  const [state, action, pending] = useActionState<ConfirmCommunityState, FormData>(confirmCommunityRequestAction, { status: "idle" });

  const slugProblem = state.status === "error" && (state.code === "slugTaken" || state.code === "slugInvalid");
  const showSlug = slugTaken || slugProblem;
  const errorText =
    state.status !== "error"
      ? slugTaken
        ? t("errors.slugTaken")
        : null
      : state.code === "unexpected"
        ? tc("unexpectedError")
        : state.code === "limit"
          ? t("errors.limit", { max: MAX_FOUNDED_COMMUNITIES })
          : t(`errors.${state.code}`);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      {showSlug && (
        <div className="grid gap-2">
          <Label htmlFor="slug">{t("slugLabel")}</Label>
          <Input id="slug" name="slug" required minLength={3} maxLength={40} defaultValue={slug} />
        </div>
      )}
      {errorText && (
        <p className="text-sm text-destructive" role="alert">
          {errorText}
        </p>
      )}
      <Button type="submit" disabled={pending} className="justify-self-start">
        {t("submit")}
      </Button>
    </form>
  );
}
