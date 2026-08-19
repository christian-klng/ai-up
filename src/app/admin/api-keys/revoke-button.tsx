"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { revokeApiKeyAction } from "@/server/actions/admin-api-keys";
import { Button } from "@/components/ui/button";

export function RevokeKeyButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("admin.apiKeys");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!confirm(t("confirmRevoke", { name }))) return;
        start(async () => {
          await revokeApiKeyAction(id);
          toast.success(t("revokedToast"));
          router.refresh();
        });
      }}
    >
      <Ban className="size-4" /> {t("revoke")}
    </Button>
  );
}
