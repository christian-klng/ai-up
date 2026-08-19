"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { restoreVersionAction } from "@/server/actions/content";
import { Button } from "@/components/ui/button";

export function RestoreButton({ contentId, versionId, note, label, successLabel }: { contentId: string; versionId: string; note: string; label: string; successLabel: string }) {
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await restoreVersionAction(contentId, versionId, note);
          if (res.ok) {
            toast.success(successLabel);
            router.push(`?`);
            router.refresh();
          } else toast.error(tc("unexpectedError"));
        })
      }
    >
      <RotateCcw className="size-4" /> {label}
    </Button>
  );
}
