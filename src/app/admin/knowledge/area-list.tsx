"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { deleteAreaAction, moveAreaAction } from "@/server/actions/admin-knowledge";
import { AreaIcon } from "@/components/knowledge/area-icon";
import { Button } from "@/components/ui/button";
import { AreaDialog, type AreaFormValues } from "./area-dialog";
import { AreaTemplatesDialog, type TemplateOption } from "./area-templates-dialog";

type Area = AreaFormValues & { slug: string; contentCount: number; assignedTemplateIds: string[] };

export function AreaList({ areas, templates }: { areas: Area[]; templates: TemplateOption[] }) {
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
            </div>
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{a.purpose}</p>
          </div>
          <div className="flex items-center gap-1">
            <AreaTemplatesDialog areaId={a.id} areaName={a.name} templates={templates} assignedIds={a.assignedTemplateIds} />
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
