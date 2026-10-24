"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Globe, Pencil, Trash2 } from "lucide-react";
import { deleteAreaAction, moveAreaAction, setCollectionPublicAction } from "@/server/actions/admin-knowledge";
import { AreaIcon } from "@/components/knowledge/area-icon";
import { Button } from "@/components/ui/button";
import { AreaDialog, type AreaFormValues } from "./area-dialog";
import { AreaTemplatesDialog, type TemplateOption } from "./area-templates-dialog";

type Area = AreaFormValues & { slug: string; contentCount: number; assignedTemplateIds: string[]; publicOnSite: boolean };

export function AreaList({ areas, templates, canPublish }: { areas: Area[]; templates: TemplateOption[]; canPublish: boolean }) {
  const t = useTranslations("admin.knowledge");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();

  if (areas.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {areas.map((a, i) => (
        <li key={a.id} className="flex flex-wrap items-start gap-4 px-4 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <AreaIcon icon={a.icon} className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/knowledge/${a.slug}`} className="font-medium hover:underline">
                {a.name}
              </Link>
              <span className="text-xs text-muted-foreground">/{a.slug}</span>
              <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{t("contentCount", { count: a.contentCount })}</span>
              {a.assignedTemplateIds.length > 0 ? (
                <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary">{t("templateCount", { count: a.assignedTemplateIds.length })}</span>
              ) : (
                <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{t("defaultTemplatesBadge")}</span>
              )}
              {a.publicOnSite && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 text-xs text-amber-800 dark:text-amber-300">
                  <Globe className="size-3" /> {t("publicBadge")}
                </span>
              )}
            </div>
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{a.purpose}</p>
          </div>
          <div className="flex items-center gap-1">
            <AreaTemplatesDialog areaId={a.id} areaName={a.name} templates={templates} assignedIds={a.assignedTemplateIds} />
            {canPublish && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={a.publicOnSite ? t("makePrivate") : t("makePublic")}
                title={a.publicOnSite ? t("makePrivate") : t("makePublic")}
                aria-pressed={a.publicOnSite}
                className={a.publicOnSite ? "text-amber-700 dark:text-amber-300" : undefined}
                disabled={pending}
                onClick={() => {
                  if (!a.publicOnSite && !confirm(t("confirmPublic", { name: a.name }))) return;
                  start(async () => {
                    const res = await setCollectionPublicAction(a.id, !a.publicOnSite);
                    if (res.ok) {
                      toast.success(tc("saved"));
                      router.refresh();
                    } else toast.error(tc("unexpectedError"));
                  });
                }}
              >
                <Globe className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" aria-label="up" disabled={pending || i === 0} onClick={() => start(async () => { await moveAreaAction(a.id, "up"); router.refresh(); })}>
              <ArrowUp className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="down" disabled={pending || i === areas.length - 1} onClick={() => start(async () => { await moveAreaAction(a.id, "down"); router.refresh(); })}>
              <ArrowDown className="size-4" />
            </Button>
            <AreaDialog
              mode="edit"
              area={a}
              trigger={
                <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                  <Pencil className="size-4" />
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={tc("delete")}
              disabled={pending}
              onClick={() => {
                if (!confirm(t("confirmDelete", { name: a.name }))) return;
                start(async () => {
                  const res = await deleteAreaAction(a.id);
                  if (res.ok) {
                    toast.success(t("deleted"));
                    router.refresh();
                  } else toast.error(t("notEmpty"));
                });
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
