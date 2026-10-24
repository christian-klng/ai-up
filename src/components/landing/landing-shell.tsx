import Link from "next/link";
import type { Community } from "@/server/db/schema";
import { isFragmentHref, type LandingDefinition } from "@/lib/landing-schema";
import { eventWidgetLocale } from "@/lib/event-widgets";
import { Menu } from "lucide-react";
import { BrandLogo } from "@/components/shell/brand-logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LandingSectionView, type SectionLabels } from "./sections";
import type { PostFeed } from "@/server/domain/posts";

export type LandingLabels = { toApp: string; signIn: string; register: string; menu: string } & SectionLabels;

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
  eventsUrl,
  nav = [],
  posts,
  editing,
  children,
}: {
  definition: LandingDefinition;
  settings: Community;
  signedIn: boolean;
  labels: LandingLabels;
  /** Origin of the event service for this community (`getEventsWidgetUrl`); null = no event widgets */
  eventsUrl: string | null;
  /** Custom pages marked for the navigation (listNavPages) */
  nav?: { title: string; href: string }[];
  /** Server-resolved posts per collection id for the posts sections (resolvePostFeeds) */
  posts?: Record<string, PostFeed>;
  /** Inline-editor mode: FAQ items render expanded so their answers are clickable */
  editing?: boolean;
  /** Replaces the sections, e.g. a single post – header, navigation and footer stay the page's */
  children?: React.ReactNode;
}) {
  const events = eventsUrl ? { url: eventsUrl, locale: eventWidgetLocale(settings.defaultLocale), texts: definition.eventTexts ?? {} } : null;
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <BrandLogo settings={settings} size={28} />
            <span className="truncate font-semibold tracking-tight">{settings.name}</span>
          </Link>
          {nav.length > 0 && (
            <nav className="ml-2 hidden min-w-0 flex-1 items-center gap-1 md:flex">
              {nav.map((item) => (
                <Link key={item.href} href={item.href} className="truncate rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                  {item.title}
                </Link>
              ))}
            </nav>
          )}
          {/* Desktop: inline buttons */}
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
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
              <Button variant="ghost" size="icon" className={nav.length > 0 ? "md:hidden" : "sm:hidden"} aria-label={labels.menu}>
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64 p-4">
              <SheetTitle className="flex items-center gap-2.5 px-1 text-base">
                <BrandLogo settings={settings} size={24} />
                <span className="truncate">{settings.name}</span>
              </SheetTitle>
              {nav.length > 0 && (
                <nav className="mt-6 grid gap-1">
                  {nav.map((item) => (
                    <Link key={item.href} href={item.href} className="rounded-md px-2 py-2 text-sm hover:bg-muted">
                      {item.title}
                    </Link>
                  ))}
                </nav>
              )}
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
        {children ??
          definition.sections.map((section, i) => (
            <LandingSectionView key={i} section={section} path={`sections.${i}`} settings={settings} events={events} posts={posts} labels={labels} editing={editing} />
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
                isFragmentHref(link.href) ? (
                  <a key={i} href={link.href} className="hover:text-foreground hover:underline" data-ep={`footer.links.${i}.label`}>
                    {link.label}
                  </a>
                ) : link.href.startsWith("/") ? (
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
