"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, MoreHorizontal, ShieldCheck, ShieldOff, UserCheck, UserMinus, UserX } from "lucide-react";
import { approveMemberAction, removeMemberAction, setMemberRoleAction, setMemberStatusAction, type MemberActionResult } from "@/server/actions/admin-settings";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Props = { userId: string; name: string; status: "pending" | "active" | "suspended"; role: "member" | "admin"; isSelf: boolean };

export function MemberActions({ userId, name, status, role, isSelf }: Props) {
  const t = useTranslations("admin.members");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<MemberActionResult>, successKey: "approved" | "suspended" | "reactivated" | "roleChanged" | "removed") =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(t(successKey, { name: res.name }));
        router.refresh();
        return;
      }
      toast.error(res.reason === "self" ? t("cannotChangeSelf") : res.reason === "lastAdmin" ? t("lastAdmin") : tc("unexpectedError"));
    });

  if (isSelf) return null;

  return (
    <div className="flex items-center gap-2">
      {status !== "active" && (
        <Button size="sm" disabled={pending} onClick={() => run(() => (status === "pending" ? approveMemberAction(userId) : setMemberStatusAction(userId, "active")), status === "pending" ? "approved" : "reactivated")}>
          {status === "pending" ? <Check className="size-4" /> : <UserCheck className="size-4" />}
          {status === "pending" ? t("approve") : t("reactivate")}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={tc("actions")} disabled={pending}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {status === "active" && (
            <DropdownMenuItem onSelect={() => run(() => setMemberStatusAction(userId, "suspended"), "suspended")}>
              <UserX className="size-4" /> {t("suspend")}
            </DropdownMenuItem>
          )}
          {status === "suspended" && (
            <DropdownMenuItem onSelect={() => run(() => setMemberStatusAction(userId, "active"), "reactivated")}>
              <UserCheck className="size-4" /> {t("reactivate")}
            </DropdownMenuItem>
          )}
          {role === "member" ? (
            <DropdownMenuItem onSelect={() => run(() => setMemberRoleAction(userId, "admin"), "roleChanged")}>
              <ShieldCheck className="size-4" /> {t("makeAdmin")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => run(() => setMemberRoleAction(userId, "member"), "roleChanged")}>
              <ShieldOff className="size-4" /> {t("removeAdmin")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              // Removing only ends the membership – the account and its other communities stay.
              if (confirm(t("removeConfirm", { name }))) run(() => removeMemberAction(userId), "removed");
            }}
          >
            <UserMinus className="size-4" /> {t("remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="sr-only">{name}</span>
    </div>
  );
}
