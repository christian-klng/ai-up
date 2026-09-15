"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { deleteMeetingAction } from "@/server/actions/meetings";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MeetingDialog, type MeetingFormValues } from "./meeting-dialog";
import { InviteLinkDialog, type InviteLinkState } from "./invite-link-dialog";

/** `invite` is null for non-admins – only admins may hand out the invite link. */
export function MeetingActions({ meeting, spaceId, spaceSlug, recordingDefault, callsAvailable, invite }: { meeting: MeetingFormValues; spaceId: string; spaceSlug: string; recordingDefault: boolean; callsAvailable: boolean; invite: InviteLinkState | null }) {
  const t = useTranslations("meetings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);
  return (
    <div className="flex items-center gap-1">
      {invite && <InviteLinkDialog meetingId={meeting.id} invite={invite} open={inviteOpen} onOpenChange={setInviteOpen} />}
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
          {invite && (
            <DropdownMenuItem onSelect={() => setInviteOpen(true)}>
              <Link2 className="size-4" /> {t("invite.menu")}
            </DropdownMenuItem>
          )}
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
