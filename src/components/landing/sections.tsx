import Link from "next/link";
import { LANDING_ICON_MAP } from "./icon-map";
import type { AppSettings } from "@/server/db/schema";
import type { LandingSection } from "@/lib/landing-schema";
import { Markdown } from "@/components/content/markdown";
import { BrandLogo } from "@/components/shell/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// `data-ep` marks definition-sourced text with its JSON path; the admin inline editor uses it
// as click target, on the public page the attribute is inert.
function CtaLink({ cta, path, variant }: { cta: { label: string; href: string }; path: string; variant?: "default" | "outline" }) {
  const external = !cta.href.startsWith("/");
  return (
    <Button asChild variant={variant} size="lg">
      {external ? (
        <a href={cta.href} target="_blank" rel="noopener noreferrer" data-ep={`${path}.label`}>
          {cta.label}
        </a>
      ) : (
        <Link href={cta.href} data-ep={`${path}.label`}>
          {cta.label}
        </Link>
      )}
    </Button>
  );
}

export function LandingSectionView({
  section,
  path,
  settings,
  faqOpen,
}: {
  section: LandingSection;
  path: string;
  settings: AppSettings;
  /** Render FAQ items expanded (inline editor: answers must be clickable) */
  faqOpen?: boolean;
}) {
  switch (section.type) {
    case "hero":
      return (
        <section className="flex flex-col items-center gap-5 py-14 text-center sm:py-20">
          {section.showLogo && <BrandLogo settings={settings} size={56} />}
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl" data-ep={`${path}.headline`}>
            {section.headline}
          </h1>
          {section.subline && (
            <p className="max-w-2xl text-lg text-muted-foreground text-balance" data-ep={`${path}.subline`}>
              {section.subline}
            </p>
          )}
          {(section.primaryCta || section.secondaryCta) && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
              {section.primaryCta && <CtaLink cta={section.primaryCta} path={`${path}.primaryCta`} />}
              {section.secondaryCta && <CtaLink cta={section.secondaryCta} path={`${path}.secondaryCta`} variant="outline" />}
            </div>
          )}
          {section.imageMediaId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${section.imageMediaId}`} alt="" className="mt-6 max-h-[420px] w-full max-w-4xl rounded-xl border object-cover shadow-sm" />
          )}
        </section>
      );
    case "features":
      return (
        <section className="py-10">
          {section.title && (
            <h2 className="text-center text-2xl font-semibold tracking-tight text-balance" data-ep={`${path}.title`}>
              {section.title}
            </h2>
          )}
          {section.intro && (
            <p className="mx-auto mt-2 max-w-2xl text-center text-muted-foreground" data-ep={`${path}.intro`}>
              {section.intro}
            </p>
          )}
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item, i) => {
              const Icon = LANDING_ICON_MAP[item.icon];
              return (
                <Card key={i}>
                  <CardContent className="flex flex-col gap-2.5 pt-5">
                    <span className="inline-flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <h3 className="font-semibold" data-ep={`${path}.items.${i}.title`}>
                      {item.title}
                    </h3>
                    <p className="text-sm text-muted-foreground" data-ep={`${path}.items.${i}.text`}>
                      {item.text}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      );
    case "markdown":
      return (
        <section className="mx-auto max-w-3xl py-10">
          {section.title && (
            <h2 className="mb-4 text-2xl font-semibold tracking-tight text-balance" data-ep={`${path}.title`}>
              {section.title}
            </h2>
          )}
          <div data-ep-md={`${path}.body`}>
            <Markdown>{section.body}</Markdown>
          </div>
        </section>
      );
    case "cta":
      return (
        <section className="py-10">
          <div className="flex flex-col items-center gap-4 rounded-xl bg-primary px-6 py-12 text-center text-primary-foreground">
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl" data-ep={`${path}.headline`}>
              {section.headline}
            </h2>
            {section.text && (
              <p className="max-w-2xl text-primary-foreground/85 text-balance" data-ep={`${path}.text`}>
                {section.text}
              </p>
            )}
            <Button asChild size="lg" variant="secondary" className="mt-1">
              {section.button.href.startsWith("/") ? (
                <Link href={section.button.href} data-ep={`${path}.button.label`}>
                  {section.button.label}
                </Link>
              ) : (
                <a href={section.button.href} target="_blank" rel="noopener noreferrer" data-ep={`${path}.button.label`}>
                  {section.button.label}
                </a>
              )}
            </Button>
          </div>
        </section>
      );
    case "faq":
      return (
        <section className="mx-auto max-w-3xl py-10">
          {section.title && (
            <h2 className="mb-6 text-2xl font-semibold tracking-tight text-balance" data-ep={`${path}.title`}>
              {section.title}
            </h2>
          )}
          <div className="grid gap-2">
            {section.items.map((item, i) => (
              <details key={i} open={faqOpen || undefined} className="group rounded-lg border bg-card px-4 py-3">
                <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                  <span data-ep={`${path}.items.${i}.question`}>{item.question}</span>
                </summary>
                <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground" data-ep={`${path}.items.${i}.answer`}>
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </section>
      );
    case "image":
      return (
        <section className="mx-auto max-w-4xl py-10">
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${section.mediaId}`} alt={section.alt} className="w-full rounded-xl border object-cover shadow-sm" />
            {section.caption && (
              <figcaption className="mt-2 text-center text-sm text-muted-foreground" data-ep={`${path}.caption`}>
                {section.caption}
              </figcaption>
            )}
          </figure>
        </section>
      );
  }
}
