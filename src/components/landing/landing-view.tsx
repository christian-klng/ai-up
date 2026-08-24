import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppSettings } from "@/server/db/schema";
import type { LandingDefinition } from "@/lib/landing-schema";
import { BrandLogo } from "@/components/shell/brand-logo";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { Button } from "@/components/ui/button";
import { LandingSectionView } from "./sections";

/**
 * Renders the public landing page from its structured definition. Colors, radius and
 * dark mode come from the injected brand theme in the root layout – sections carry copy only.
 */
export async function LandingView({
  definition,
  settings,
  signedIn,
}: {
  definition: LandingDefinition;
  settings: AppSettings;
  signedIn: boolean;
}) {
  const [t, tCommon] = await Promise.all([getTranslations("landing"), getTranslations("common")]);
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <BrandLogo settings={settings} size={28} />
            <span className="truncate font-semibold tracking-tight">{settings.name}</span>
          </Link>
          <div className="flex items-center gap-2">
            <LocaleSwitcher label={tCommon("language")} />
            {signedIn ? (
              <Button asChild size="sm">
                <Link href="/home">{t("toApp")}</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/login">{t("signIn")}</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/register">{t("register")}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6 lg:px-8">
        {definition.sections.map((section, i) => (
          <LandingSectionView key={i} section={section} settings={settings} />
        ))}
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
          {definition.footer.text && <p className="whitespace-pre-line">{definition.footer.text}</p>}
          {definition.footer.links.length > 0 && (
            <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              {definition.footer.links.map((link, i) =>
                link.href.startsWith("/") ? (
                  <Link key={i} href={link.href} className="hover:text-foreground hover:underline">
                    {link.label}
                  </Link>
                ) : (
                  <a key={i} href={link.href} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
                    {link.label}
                  </a>
                ),
              )}
            </nav>
          )}
        </div>
      </footer>
    </div>
  );
}
