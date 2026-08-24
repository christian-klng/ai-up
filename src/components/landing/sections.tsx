import Link from "next/link";
import {
  BookOpen,
  Brain,
  Calendar,
  Globe,
  GraduationCap,
  Handshake,
  Heart,
  Lightbulb,
  MessageCircle,
  Rocket,
  Shield,
  Sparkles,
  Target,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { AppSettings } from "@/server/db/schema";
import type { LandingIcon, LandingSection } from "@/lib/landing-schema";
import { Markdown } from "@/components/content/markdown";
import { BrandLogo } from "@/components/shell/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Static map of the icon allowlist – keeps unused lucide icons out of the bundle. */
const ICONS: Record<LandingIcon, LucideIcon> = {
  sparkles: Sparkles,
  users: Users,
  "message-circle": MessageCircle,
  calendar: Calendar,
  "book-open": BookOpen,
  workflow: Workflow,
  shield: Shield,
  zap: Zap,
  heart: Heart,
  globe: Globe,
  lightbulb: Lightbulb,
  rocket: Rocket,
  target: Target,
  "graduation-cap": GraduationCap,
  handshake: Handshake,
  brain: Brain,
};

function CtaLink({ cta, variant }: { cta: { label: string; href: string }; variant?: "default" | "outline" }) {
  const external = !cta.href.startsWith("/");
  return (
    <Button asChild variant={variant} size="lg">
      {external ? (
        <a href={cta.href} target="_blank" rel="noopener noreferrer">
          {cta.label}
        </a>
      ) : (
        <Link href={cta.href}>{cta.label}</Link>
      )}
    </Button>
  );
}

export function LandingSectionView({ section, settings }: { section: LandingSection; settings: AppSettings }) {
  switch (section.type) {
    case "hero":
      return (
        <section className="flex flex-col items-center gap-5 py-14 text-center sm:py-20">
          {section.showLogo && <BrandLogo settings={settings} size={56} />}
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{section.headline}</h1>
          {section.subline && <p className="max-w-2xl text-lg text-muted-foreground text-balance">{section.subline}</p>}
          {(section.primaryCta || section.secondaryCta) && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
              {section.primaryCta && <CtaLink cta={section.primaryCta} />}
              {section.secondaryCta && <CtaLink cta={section.secondaryCta} variant="outline" />}
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
          {section.title && <h2 className="text-center text-2xl font-semibold tracking-tight text-balance">{section.title}</h2>}
          {section.intro && <p className="mx-auto mt-2 max-w-2xl text-center text-muted-foreground">{section.intro}</p>}
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item, i) => {
              const Icon = ICONS[item.icon];
              return (
                <Card key={i}>
                  <CardContent className="flex flex-col gap-2.5 pt-5">
                    <span className="inline-flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.text}</p>
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
          {section.title && <h2 className="mb-4 text-2xl font-semibold tracking-tight text-balance">{section.title}</h2>}
          <Markdown>{section.body}</Markdown>
        </section>
      );
    case "cta":
      return (
        <section className="py-10">
          <div className="flex flex-col items-center gap-4 rounded-xl bg-primary px-6 py-12 text-center text-primary-foreground">
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{section.headline}</h2>
            {section.text && <p className="max-w-2xl text-primary-foreground/85 text-balance">{section.text}</p>}
            <Button asChild size="lg" variant="secondary" className="mt-1">
              {section.button.href.startsWith("/") ? (
                <Link href={section.button.href}>{section.button.label}</Link>
              ) : (
                <a href={section.button.href} target="_blank" rel="noopener noreferrer">
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
          {section.title && <h2 className="mb-6 text-2xl font-semibold tracking-tight text-balance">{section.title}</h2>}
          <div className="grid gap-2">
            {section.items.map((item, i) => (
              <details key={i} className="group rounded-lg border bg-card px-4 py-3">
                <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                  {item.question}
                </summary>
                <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{item.answer}</p>
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
            {section.caption && <figcaption className="mt-2 text-center text-sm text-muted-foreground">{section.caption}</figcaption>}
          </figure>
        </section>
      );
  }
}
