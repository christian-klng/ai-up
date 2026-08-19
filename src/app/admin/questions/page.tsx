import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { listQuestions } from "@/server/domain/questions";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";

export default async function AdminQuestionsPage() {
  await requireAdmin();
  const [t, format, items] = await Promise.all([getTranslations("admin.questions"), getFormatter(), listQuestions({ limit: 100 })]);
  return (
    <div className="max-w-4xl">
      <PageHeader title={t("title")} description={t("intro")} />
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t("empty")}</div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {items.map((q) => {
            const open = q.isOpen;
            return (
              <li key={q.id}>
                <Link href={`/admin/questions/${q.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-accent/40">
                  <Badge variant={open ? "default" : "secondary"}>{open ? t("open") : t("closed")}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{q.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      <code>{q.questionKey}</code> · {q.workflowName ?? "–"} · {format.dateTime(q.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums">{t("responses", { count: q.responseCount })}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
