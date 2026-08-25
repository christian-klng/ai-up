import Link from "next/link";
import type { AppSettings } from "@/server/db/schema";
import type { LandingDefinition } from "@/lib/landing-schema";
import { BrandLogo } from "@/components/shell/brand-logo";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { Button } from "@/components/ui/button";
import { LandingSectionView } from "./sections";

export type LandingLabels = { toApp: string; signIn: string; register: string; language: string };

/**
 * Presentational landing page (header + sections + footer). Used by the public page (server)
 * and by the admin inline editor (client) – keep it free of server-only APIs.
 * Header chrome comes from settings/labels (not editable); definition texts carry data-ep paths.
 */
export function LandingShell({
  definition,
  settings,
  signedIn,
  labels,
}: {
  definition: LandingDefinition;
  settings: AppSettings;
  signedIn: boolean;
  labels: LandingLabels;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <BrandLogo settings={settings} size={28} />
            <span className="truncate font-semibold tracking-tight">{settings.name}</span>
          </Link>
          <div className="flex items-center gap-2">
            <LocaleSwitcher label={labels.language} />
            {signedIn ? (
              <Button asChild size="sm">
                <Link href="/home">{labels.toApp}</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/login">{labels.signIn}</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/register">{labels.register}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6 lg:px-8">
        {definition.sections.map((section, i) => (
          <LandingSectionView key={i} section={section} path={`sections.${i}`} settings={settings} />
        ))}
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
          {definition.footer.text && (
            <p className="whitespace-pre-line" data-ep="footer.text">
              {definition.footer.text}
            </p>
          )}
          {definition.footer.links.length > 0 && (
            <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              {definition.footer.links.map((link, i) =>
                link.href.startsWith("/") ? (
                  <Link key={i} href={link.href} className="hover:text-foreground hover:underline" data-ep={`footer.links.${i}.label`}>
                    {link.label}
                  </Link>
                ) : (
                  <a
                    key={i}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground hover:underline"
                    data-ep={`footer.links.${i}.label`}
                  >
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
