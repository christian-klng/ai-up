"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { deleteTemplateAction } from "@/server/actions/admin-templates";
import { TemplateIcon } from "@/components/structures/template-icon";
import { Button } from "@/components/ui/button";

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  version: number;
  isSystem: boolean;
  assignmentCount: number;
};

export function TemplateList({ templates }: { templates: TemplateRow[] }) {
  const t = useTranslations("admin.templates");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();

  if (templates.length === 0) return <p className="text-sm text-muted-foreground">{t("listEmpty")}</p>;

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {templates.map((tpl) => (
        <li key={tpl.id} className="flex flex-wrap items-start gap-4 px-4 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <TemplateIcon icon={tpl.icon} className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/admin/templates/${tpl.id}`} className="font-medium hover:underline">
                {tpl.name}
              </Link>
              <span className="text-xs text-muted-foreground">v{tpl.version}</span>
              {tpl.isSystem && <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{t("systemBadge")}</span>}
              {tpl.assignmentCount > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary">{t("assignedCount", { count: tpl.assignmentCount })}</span>}
            </div>
            {tpl.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{tpl.description}</p>}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label={tc("edit")} asChild>
              <Link href={`/admin/templates/${tpl.id}`}>
                <Pencil className="size-4" />
              </Link>
            </Button>
            {!tpl.isSystem && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={tc("delete")}
                disabled={pending}
                onClick={() => {
                  if (!confirm(t("confirmDelete", { name: tpl.name }))) return;
                  start(async () => {
                    const res = await deleteTemplateAction(tpl.id);
                    if (res.ok) {
                      toast.success(t("deleted"));
                      router.refresh();
                    } else toast.error(tc("unexpectedError"));
                  });
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
