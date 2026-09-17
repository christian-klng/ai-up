"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { joinViaMeetingInviteAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";

/**
 * Offered to a visitor who is signed in but not yet a member of this meeting's community: joining
 * and going to the meeting is one step, the same one registration through this link performs.
 */
export function MeetingJoinButton({ token }: { token: string }) {
  const t = useTranslations("auth.invite");
  const tj = useTranslations("auth.join");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();

  const join = () =>
    start(async () => {
      const res = await joinViaMeetingInviteAction(token);
      if (res.ok) {
        // The action already revalidated the layouts, so pushing picks up the new community.
        router.push(res.href);
        return;
      }
      toast.error(res.reason === "suspended" ? tj("suspended") : res.reason === "invalid" ? t("invalidBody") : tc("unexpectedError"));
      if (res.reason === "unauthenticated") router.refresh();
    });

  return (
    <Button size="lg" className="w-full" disabled={pending} onClick={join}>
      {t("joinAndOpen")}
    </Button>
  );
}
