"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Globe, GlobeLock } from "lucide-react";
import { setPublishedAction } from "@/server/actions/content";
import { Button } from "@/components/ui/button";

/** Admins publish or withdraw an entry of a collection that is shown on public pages. */
export function PublishControl({ contentId, published }: { contentId: string; published: boolean }) {
  const t = useTranslations("knowledge.publish");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();

  const toggle = () => {
    if (!published && !confirm(t("confirmPublish"))) return;
    start(async () => {
      const res = await setPublishedAction(contentId, !published);
      if (res.ok) {
        toast.success(published ? t("withdrawn") : t("published"));
        router.refresh();
      } else toast.error(res.error === "collection_not_public" ? t("collectionNotPublic") : tc("unexpectedError"));
    });
  };

  return (
    <Button variant={published ? "outline" : "default"} size="sm" disabled={pending} onClick={toggle}>
      {published ? <GlobeLock className="size-4" /> : <Globe className="size-4" />} {published ? t("withdraw") : t("publish")}
    </Button>
  );
}
