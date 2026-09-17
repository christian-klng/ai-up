"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { joinCommunityAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";

/** One-click join for a visitor who is already signed in with another community. */
export function JoinButton({ token, community }: { token: string; community: string }) {
  const t = useTranslations("auth.join");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();

  const join = () =>
    start(async () => {
      const res = await joinCommunityAction(token);
      if (res.ok) {
        toast.success(t("joinedToast", { community }));
        // The action already revalidated the layouts, so pushing picks up the new community.
        router.push("/home");
        return;
      }
      toast.error(res.reason === "suspended" ? t("suspended") : res.reason === "invalid" ? t("invalidBody") : tc("unexpectedError"));
      if (res.reason === "unauthenticated") router.refresh();
    });

  return (
    <Button size="lg" className="w-full" disabled={pending} onClick={join}>
      {t("joinAsMember", { community })}
    </Button>
  );
}
