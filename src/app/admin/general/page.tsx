import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { getAppSettings } from "@/server/domain/settings";
import { PageHeader } from "@/components/common/page-header";
import { GeneralSettingsForm } from "./general-form";
import { BrandingImageCard } from "./branding-image-card";

export default async function AdminGeneralPage() {
  await requireAdmin();
  const [t, settings] = await Promise.all([getTranslations("admin.general"), getAppSettings()]);

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("intro")} />
      <div className="grid gap-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <BrandingImageCard kind="logo" title={t("logo")} hint={t("logoHint")} mediaId={settings.logoMediaId} removeLabel={t("removeImage")} accept="image/png,image/jpeg,image/webp,image/svg+xml" />
          <BrandingImageCard kind="favicon" title={t("favicon")} hint={t("faviconHint")} mediaId={settings.faviconMediaId} removeLabel={t("removeImage")} accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml" />
        </div>
        <GeneralSettingsForm settings={{ name: settings.name, tagline: settings.tagline, botName: settings.botName, theme: settings.theme, defaultLocale: settings.defaultLocale }} />
      </div>
    </div>
  );
}
