import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { getAppSettings } from "@/server/domain/settings";
import { getCurrentLandingVersion } from "@/server/domain/landing";
import { LandingView } from "@/components/landing/landing-view";

/** Admin-only full-page preview of the landing page, independent of the enabled flag. */
export default async function LandingPreviewPage() {
  await requireAdmin();
  const [settings, landing] = await Promise.all([getAppSettings(), getCurrentLandingVersion()]);
  if (!landing) {
    const t = await getTranslations("admin.landing");
    return <div className="flex min-h-svh items-center justify-center p-8 text-muted-foreground">{t("noContentYet")}</div>;
  }
  return <LandingView definition={landing.definition} settings={settings} signedIn />;
}
