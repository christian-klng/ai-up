import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/session";
import { getAppSettings } from "@/server/domain/settings";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { BrandLogo } from "@/components/shell/brand-logo";

/**
 * Frame for public content pages (currently the meeting invite): the same slim header as the
 * landing page and a wide main column, unlike the narrow card frame of the auth pages.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [settings, user, t, ta] = await Promise.all([getAppSettings(), getCurrentUser(), getTranslations("common"), getTranslations("auth")]);
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <BrandLogo settings={settings} size={28} />
            <span className="truncate font-semibold tracking-tight">{settings.name}</span>
          </Link>
          <div className="flex items-center gap-3">
            <LocaleSwitcher label={t("language")} />
            {!user && (
              <Button asChild size="sm" variant="ghost">
                <Link href="/login">{ta("signIn")}</Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
