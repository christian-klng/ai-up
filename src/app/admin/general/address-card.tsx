"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Where this community lives. With sub-domains that is its own host, otherwise the `/c/<slug>`
 * link on the main one – either way the address to hand out so a link lands here and not in
 * whichever community the reader happened to be in.
 */
export function AddressCard({ url }: { url: string }) {
  const t = useTranslations("admin.general.address");

  const copy = () =>
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success(t("copied")))
      .catch(() => toast.error(t("copyFailed")));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("intro")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 p-3">
          <code className="min-w-0 flex-1 truncate text-xs">{url}</code>
          <Button variant="outline" size="sm" onClick={copy}>
            <Copy className="size-4" /> {t("copy")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
