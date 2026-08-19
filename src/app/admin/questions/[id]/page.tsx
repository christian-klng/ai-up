import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { getQuestionWithResponses } from "@/server/domain/questions";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/shell/user-avatar";
import { CloseQuestionButton } from "./close-button";

export default async function AdminQuestionDetailPage({ params }: PageProps<"/admin/questions/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const data = await getQuestionWithResponses(id);
  if (!data) notFound();
  const [t, format] = await Promise.all([getTranslations("admin.questions"), getFormatter()]);
  const { question, responses, stats, open } = data;
  return (
    <div className="max-w-4xl">
      <Link href="/admin/questions" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("title")}
      </Link>
      <PageHeader
        title={question.title}
        description={question.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={open ? "default" : "secondary"}>{open ? t("open") : t("closed")}</Badge>
            {open && <CloseQuestionButton id={question.id} />}
          </div>
        }
      />
      <p className="mb-4 text-xs text-muted-foreground">
        <code>{question.questionKey}</code> · {t("audience")}: {question.audience.type} · {t("responses", { count: stats.responses })} · {format.dateTime(question.createdAt, { dateStyle: "medium", timeStyle: "short" })}
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="grid gap-4">
          <h2 className="text-base font-semibold">{t("distribution")}</h2>
          {question.fields.map((f) => {
            const d = stats.distribution[f.key];
            const total = d ? Object.values(d).reduce((a, b) => a + b, 0) : 0;
            return (
              <div key={f.key} className="rounded-lg border bg-card p-4">
                <div className="text-sm font-medium">{f.label}</div>
                <div className="text-xs text-muted-foreground">{f.type}</div>
                {d && total > 0 ? (
                  <ul className="mt-2 grid gap-1">
                    {Object.entries(d)
                      .sort((a, b) => b[1] - a[1])
                      .map(([k, n]) => (
                        <li key={k} className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
                          <span className="flex items-center gap-2">
                            <span className="h-2 rounded bg-primary/70" style={{ width: `${Math.max(4, Math.round((n / total) * 160))}px` }} />
                            {k === "true" ? t("yes") : k === "false" ? t("no") : k}
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {n} · {Math.round((n / total) * 100)} %
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">{f.type === "text" ? t("textAnswersBelow") : t("noAnswers")}</p>
                )}
              </div>
            );
          })}
        </section>
        <section>
          <h2 className="mb-2 text-base font-semibold">{t("answers")}</h2>
          {responses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noAnswers")}</p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {responses.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 text-sm">
                    <UserAvatar user={r.user} size={22} variant="thumb" />
                    <span className="font-medium">{r.user.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                  </div>
                  <dl className="mt-1 grid gap-0.5 text-sm">
                    {Object.entries(r.answers).map(([k, v]) => (
                      <div key={k} className="grid grid-cols-[120px_1fr] gap-2">
                        <dt className="truncate text-muted-foreground">{question.fields.find((f) => f.key === k)?.label ?? k}</dt>
                        <dd className="break-words">{Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? t("yes") : t("no")) : String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
