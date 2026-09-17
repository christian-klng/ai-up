"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BadgeCheck, Clock, Copy, RefreshCw, Trash2 } from "lucide-react";
import { addDomainAction, removeDomainAction, setPrimaryDomainAction, verifyDomainAction } from "@/server/actions/domains";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type DomainRow = { id: string; host: string; verifyToken: string; verified: boolean; isPrimary: boolean };

/**
 * Entering and proving a community's own domain.
 *
 * The screen has to carry the whole setup, because the work happens somewhere else entirely – in
 * the visitor's DNS provider. So it names both records, shows the exact values to copy, and says
 * plainly what a failed check means: not "invalid", but "not visible yet".
 */
export function DomainCard({ domains, appHost }: { domains: DomainRow[]; appHost: string }) {
  const t = useTranslations("admin.general.domains");
  const router = useRouter();
  const [host, setHost] = useState("");
  const [pending, start] = useTransition();

  const copy = (value: string) =>
    navigator.clipboard
      .writeText(value)
      .then(() => toast.success(t("copied")))
      .catch(() => toast.error(t("copyFailed")));

  const add = () =>
    start(async () => {
      const res = await addDomainAction(host);
      if (!res.ok) {
        toast.error(t(`error.${res.reason}`));
        return;
      }
      setHost("");
      toast.success(t("added"));
      router.refresh();
    });

  const verify = (id: string) =>
    start(async () => {
      const res = await verifyDomainAction(id);
      if (res.ok) toast.success(t("verified"));
      else toast.error(t(`verifyError.${res.reason}`));
      router.refresh();
    });

  const makePrimary = (id: string) =>
    start(async () => {
      const res = await setPrimaryDomainAction(id);
      if (res.ok) toast.success(t("primarySet"));
      router.refresh();
    });

  const remove = (id: string) =>
    start(async () => {
      await removeDomainAction(id);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("intro")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {domains.map((d) => (
          <div key={d.id} className="grid gap-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-sm font-medium">{d.host}</code>
              {d.verified ? (
                <Badge variant="secondary" className="gap-1">
                  <BadgeCheck className="size-3.5" aria-hidden /> {t("state.verified")}
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <Clock className="size-3.5" aria-hidden /> {t("state.pending")}
                </Badge>
              )}
              {d.isPrimary && <Badge>{t("state.primary")}</Badge>}
            </div>

            {!d.verified && (
              <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-sm">
                <p className="text-muted-foreground">{t("proofIntro")}</p>
                <Record label={t("proofTxtName")} value={`_aiup-verify.${d.host}`} onCopy={copy} />
                <Record label={t("proofTxtValue")} value={d.verifyToken} onCopy={copy} />
                <p className="text-muted-foreground">{t("proofOr")}</p>
                <Record label={t("proofCname")} value={appHost} onCopy={copy} />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {!d.verified && (
                <Button variant="outline" size="sm" disabled={pending} onClick={() => verify(d.id)}>
                  <RefreshCw className="size-4" /> {t("check")}
                </Button>
              )}
              {d.verified && !d.isPrimary && (
                <Button variant="outline" size="sm" disabled={pending} onClick={() => makePrimary(d.id)}>
                  {t("makePrimary")}
                </Button>
              )}
              <Button variant="ghost" size="sm" className="text-destructive" disabled={pending} onClick={() => remove(d.id)}>
                <Trash2 className="size-4" /> {t("remove")}
              </Button>
            </div>
          </div>
        ))}

        <div className="grid gap-2">
          <Label htmlFor="new-domain">{t("addLabel")}</Label>
          <div className="flex gap-2">
            <Input
              id="new-domain"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder={t("addPlaceholder")}
              autoComplete="off"
              spellCheck={false}
            />
            <Button disabled={pending || host.trim().length < 3} onClick={add}>
              {t("add")}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{t("addHint")}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Record({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string) => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">{value}</code>
      <Button variant="ghost" size="sm" onClick={() => onCopy(value)} aria-label={label}>
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}
