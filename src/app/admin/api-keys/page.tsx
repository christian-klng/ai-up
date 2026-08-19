import { getFormatter, getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { API_SCOPES, listApiKeys } from "@/server/domain/api-keys";
import { env } from "@/server/env";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { CreateKeyDialog } from "./create-key-dialog";
import { RevokeKeyButton } from "./revoke-button";

export default async function AdminApiKeysPage() {
  await requireAdmin();
  const [t, format, keys] = await Promise.all([getTranslations("admin.apiKeys"), getFormatter(), listApiKeys()]);
  const mcpUrl = `${env.APP_URL.replace(/\/$/, "")}/api/mcp`;
  return (
    <div className="max-w-4xl">
      <PageHeader title={t("title")} description={t("intro")} actions={<CreateKeyDialog scopes={[...API_SCOPES]} />} />

      <section className="mb-6 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">{t("mcpTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("mcpIntro")}</p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-muted/40 p-3 text-xs">{`claude mcp add --transport http aiup ${mcpUrl} --header "Authorization: Bearer <API-KEY>"`}</pre>
        <p className="mt-2 text-xs text-muted-foreground">{t("mcpHint", { url: mcpUrl })}</p>
      </section>

      {keys.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t("empty")}</div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {keys.map((k) => {
            const revoked = !!k.revokedAt;
            const expired = !!k.expiresAt && k.expiresAt < new Date();
            return (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{k.name}</span>
                    <code className="text-xs text-muted-foreground">aiup_{k.prefix}_…</code>
                    {revoked ? <Badge variant="secondary">{t("revoked")}</Badge> : expired ? <Badge variant="secondary">{t("expired")}</Badge> : <Badge>{t("active")}</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <Badge key={s} variant="outline" className="text-[10px]">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {k.ownerName} · {t("created", { date: format.dateTime(k.createdAt, { dateStyle: "medium" }) })}
                    {k.lastUsedAt && ` · ${t("lastUsed", { date: format.relativeTime(k.lastUsedAt) })}`}
                    {k.expiresAt && ` · ${t("expires", { date: format.dateTime(k.expiresAt, { dateStyle: "medium" }) })}`}
                  </div>
                </div>
                {!revoked && <RevokeKeyButton id={k.id} name={k.name} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
