"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, Check, Clock, MessageCircle, UserPlus, X } from "lucide-react";
import type { ContactState } from "@/server/domain/messenger";
import { blockContactAction, respondContactRequestAction, sendContactRequestAction, unblockContactAction } from "@/server/actions/contacts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";

/** Contact relation control on a member profile: request → pending → accepted (message) / block. */
export function ContactButton({ otherUserId, otherName, state }: { otherUserId: string; otherName: string; state: ContactState }) {
  const t = useTranslations("contacts");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  const block = () => {
    if (!confirm(t("confirmBlock", { name: otherName }))) return;
    start(async () => {
      await blockContactAction(otherUserId);
      toast.success(t("blocked"));
      router.refresh();
    });
  };

  const more = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={tc("actions")} disabled={pending}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem variant="destructive" onSelect={block}>
          <Ban className="size-4" /> {t("block")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  switch (state.status) {
    case "accepted":
      return (
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link href={state.conversationId ? `/messages/${state.conversationId}` : `/messages?with=${otherUserId}`}>
              <MessageCircle className="size-4" /> {t("sendMessage")}
            </Link>
          </Button>
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4 text-emerald-600" /> {t("connected")}
          </span>
          {more}
        </div>
      );
    case "pending_out":
      return (
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled>
            <Clock className="size-4" /> {t("requestSent")}
          </Button>
          {more}
        </div>
      );
    case "pending_in":
      return (
        <div className="grid gap-3">
          <p className="text-sm">
            {t("wantsToConnect", { name: otherName })}
            {state.message && <span className="mt-1 block rounded-md bg-muted px-3 py-2 text-muted-foreground">„{state.message}“</span>}
          </p>
          <div className="flex items-center gap-2">
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await respondContactRequestAction(state.requestId, "accept");
                  if (res.ok) {
                    toast.success(t("accepted"));
                    router.refresh();
                  }
                })
              }
            >
              <Check className="size-4" /> {t("accept")}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await respondContactRequestAction(state.requestId, "decline");
                  toast.success(t("declined"));
                  router.refresh();
                })
              }
            >
              <X className="size-4" /> {t("decline")}
            </Button>
            {more}
          </div>
        </div>
      );
    case "blocked":
      return state.byMe ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <Ban className="size-4" /> {t("youBlocked")}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await unblockContactAction(otherUserId);
                router.refresh();
              })
            }
          >
            {t("unblock")}
          </Button>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">{t("notAvailable")}</span>
      );
    case "declined":
    case "none":
    default:
      return (
        <div className="flex items-center gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="size-4" /> {t("request")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("requestTitle", { name: otherName })}</DialogTitle>
                <DialogDescription>{t("requestIntro")}</DialogDescription>
              </DialogHeader>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} rows={3} placeholder={t("messagePlaceholder")} />
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {tc("cancel")}
                </Button>
                <Button
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await sendContactRequestAction(otherUserId, message);
                      if (res.ok) {
                        toast.success(t("requestSentToast", { name: otherName }));
                        setOpen(false);
                        router.refresh();
                      } else toast.error(t(`errors.${res.error}`));
                    })
                  }
                >
                  {t("send")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {more}
        </div>
      );
  }
}
