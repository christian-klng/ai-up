"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { deleteMeetingAction } from "@/server/actions/meetings";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MeetingDialog, type MeetingFormValues } from "./meeting-dialog";

export function MeetingActions({ meeting, spaceId, spaceSlug, recordingDefault, callsAvailable }: { meeting: MeetingFormValues; spaceId: string; spaceSlug: string; recordingDefault: boolean; callsAvailable: boolean }) {
  const t = useTranslations("meetings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-1">
      <MeetingDialog
        spaceId={spaceId}
        recordingDefault={recordingDefault}
        meeting={meeting}
        callsAvailable={callsAvailable}
        trigger={
          <Button variant="outline" size="sm">
            <Pencil className="size-4" /> {tc("edit")}
          </Button>
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={tc("actions")} disabled={pending}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              if (!confirm(t("confirmDelete"))) return;
              start(async () => {
                const res = await deleteMeetingAction(meeting.id);
                if (res.ok) {
                  toast.success(t("deleted"));
                  router.push(`/meetings/${res.spaceSlug ?? spaceSlug}`);
                  router.refresh();
                } else toast.error(tc("unexpectedError"));
              });
            }}
          >
            <Trash2 className="size-4" /> {tc("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
