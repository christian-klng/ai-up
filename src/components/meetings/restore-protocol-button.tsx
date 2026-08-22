"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { restoreProtocolAction } from "@/server/actions/meetings";
import { Button } from "@/components/ui/button";

export function RestoreProtocolButton({ meetingId, versionId, note, label, successLabel }: { meetingId: string; versionId: string; note: string; label: string; successLabel: string }) {
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => { const r = await restoreProtocolAction(meetingId, versionId, note); if (r.ok) { toast.success(successLabel); router.push("?"); router.refresh(); } else toast.error(tc("unexpectedError")); })}>
      <RotateCcw className="size-4" /> {label}
    </Button>
  );
}
