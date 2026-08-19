"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { closeQuestionAction } from "@/server/actions/questions";
import { Button } from "@/components/ui/button";

export function CloseQuestionButton({ id }: { id: string }) {
  const t = useTranslations("admin.questions");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => { await closeQuestionAction(id); router.refresh(); })}>
      {t("close")}
    </Button>
  );
}
