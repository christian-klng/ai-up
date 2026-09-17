import { getTranslations } from "next-intl/server";
import { isRootCommunityId, requireAdmin, requireCommunity } from "@/server/auth/session";
import { COMMUNITY_PURGE_GRACE_DAYS } from "@/server/workflows/queue";
import { communityUrl } from "@/server/domain/communities";
import { listCommunityDomains } from "@/server/domain/community-domains";
import { env } from "@/server/env";
import { hostOf } from "@/lib/community";
import { AddressCard } from "./address-card";
import { DomainCard } from "./domain-card";
import { PageHeader } from "@/components/common/page-header";
import { GeneralSettingsForm } from "./general-form";
import { BrandingImageCard } from "./branding-image-card";
import { DeleteCommunityCard } from "./delete-community-card";

export default async function AdminGeneralPage() {
  const admin = await requireAdmin();
  const [t, settings] = await Promise.all([getTranslations("admin.general"), requireCommunity()]);
  // The operator's own community has no delete button – it *is* the installation – and no own
  // domain either: it already owns the main host (see actions/domains.ts).
  const deletable = !isRootCommunityId(admin.communityId);
  const domains = env.COMMUNITY_CUSTOM_DOMAINS && deletable ? await listCommunityDomains(admin.communityId) : [];
  const showDomains = env.COMMUNITY_CUSTOM_DOMAINS && deletable;

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("intro")} />
      <div className="grid gap-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <BrandingImageCard kind="logo" title={t("logo")} hint={t("logoHint")} mediaId={settings.logoMediaId} removeLabel={t("removeImage")} accept="image/png,image/jpeg,image/webp,image/svg+xml" />
          <BrandingImageCard kind="favicon" title={t("favicon")} hint={t("faviconHint")} mediaId={settings.faviconMediaId} removeLabel={t("removeImage")} accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml" />
        </div>
        <GeneralSettingsForm settings={{ name: settings.name, tagline: settings.tagline, theme: settings.theme, defaultLocale: settings.defaultLocale }} />
        <AddressCard url={await communityUrl(settings, "/home")} />
        {showDomains && (
          <DomainCard
            appHost={hostOf(env.APP_URL)}
            domains={domains.map((d) => ({ id: d.id, host: d.host, verifyToken: d.verifyToken, verified: d.verifiedAt !== null, isPrimary: d.isPrimary }))}
          />
        )}
        {deletable && <DeleteCommunityCard name={settings.name} graceDays={COMMUNITY_PURGE_GRACE_DAYS} />}
      </div>
    </div>
  );
}
