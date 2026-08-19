import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { listProviders, PROVIDER_PRESETS } from "@/server/llm/providers";
import { PageHeader } from "@/components/common/page-header";
import { ProviderDialog } from "./provider-dialog";
import { ProviderCard } from "./provider-card";

export default async function AdminLlmPage() {
  await requireAdmin();
  const [t, providers] = await Promise.all([getTranslations("admin.llm"), listProviders()]);
  const presets = Object.entries(PROVIDER_PRESETS).map(([kind, p]) => ({ kind, label: p.label, baseUrl: p.baseUrl, hint: p.hint }));
  return (
    <div className="max-w-4xl">
      <PageHeader title={t("title")} description={t("intro")} actions={<ProviderDialog mode="create" presets={presets} />} />
      {providers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t("empty")}</div>
      ) : (
        <div className="grid gap-4">
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              provider={{
                id: p.id,
                name: p.name,
                kind: p.kind,
                baseUrl: p.baseUrl,
                apiKeyMasked: p.apiKeyMasked,
                hasApiKey: p.hasApiKey,
                extraHeaders: p.extraHeaders,
                availableModels: p.availableModels,
                enabledModels: p.enabledModels,
                defaultModel: p.defaultModel,
                isDefault: p.isDefault,
                lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null,
                lastError: p.lastError,
              }}
              presets={presets}
            />
          ))}
        </div>
      )}
    </div>
  );
}
