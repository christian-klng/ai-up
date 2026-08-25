import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { getAppSettings } from "@/server/domain/settings";
import { getCurrentLandingVersion, listLandingMedia, listLandingVersions } from "@/server/domain/landing";
import { PageHeader } from "@/components/common/page-header";
import { LandingAdmin } from "./landing-admin";

export default async function AdminLandingPage() {
  await requireAdmin();
  const [t, settings, current, versions, media] = await Promise.all([
    getTranslations("admin.landing"),
    getAppSettings(),
    getCurrentLandingVersion(),
    listLandingVersions(),
    listLandingMedia(),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("intro")} />
      <LandingAdmin
        enabled={settings.landingEnabled}
        definition={current?.definition ?? null}
        settings={settings}
        currentVersion={current?.version ?? null}
        versions={versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() }))}
        media={media.map((m) => ({ id: m.id, originalName: m.originalName, width: m.width, height: m.height }))}
      />
    </div>
  );
}
