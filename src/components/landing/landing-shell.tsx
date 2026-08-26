import Link from "next/link";
import type { AppSettings } from "@/server/db/schema";
import type { LandingDefinition } from "@/lib/landing-schema";
import { Menu } from "lucide-react";
import { BrandLogo } from "@/components/shell/brand-logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LandingSectionView } from "./sections";

export type LandingLabels = { toApp: string; signIn: string; register: string; menu: string };

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
          {/* Desktop: inline buttons */}
          <div className="hidden items-center gap-2 sm:flex">
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
          {/* Mobile: burger menu so a long community name keeps the full width */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="sm:hidden" aria-label={labels.menu}>
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64 p-4">
              <SheetTitle className="flex items-center gap-2.5 px-1 text-base">
                <BrandLogo settings={settings} size={24} />
                <span className="truncate">{settings.name}</span>
              </SheetTitle>
              <nav className="mt-6 grid gap-2">
                {signedIn ? (
                  <Button asChild>
                    <Link href="/home">{labels.toApp}</Link>
                  </Button>
                ) : (
                  <>
                    <Button asChild>
                      <Link href="/register">{labels.register}</Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/login">{labels.signIn}</Link>
                    </Button>
                  </>
                )}
              </nav>
            </SheetContent>
          </Sheet>
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
