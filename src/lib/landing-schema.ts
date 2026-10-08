import { z } from "zod";

/**
 * Structured definition of the public landing page. Shared by the renderer, the admin
 * actions and the MCP tools: the zod schema is the hard gate for LLM-authored content –
 * colors/typography always come from the app theme, sections only carry copy and structure.
 * Framework-neutral (no React/Next imports); the DB schema type-imports LandingDefinition.
 */

/** The public site pages sharing this definition schema, versioning and image pool. */
export const SITE_PAGES = ["landing", "imprint", "privacy"] as const;
export type SitePage = (typeof SITE_PAGES)[number];

/** Allowed lucide icon names for feature items – fixed allowlist keeps the client bundle small. */
export const LANDING_ICONS = [
  "sparkles",
  "users",
  "message-circle",
  "calendar",
  "book-open",
  "workflow",
  "shield",
  "zap",
  "heart",
  "globe",
  "lightbulb",
  "rocket",
  "target",
  "graduation-cap",
  "handshake",
  "brain",
  "user",
  "user-plus",
  "user-check",
  "smile",
  "party-popper",
  "thumbs-up",
  "star",
  "award",
  "trophy",
  "crown",
  "gem",
  "gift",
  "check",
  "circle-check",
  "badge-check",
  "shield-check",
  "info",
  "circle-help",
  "mail",
  "send",
  "bell",
  "megaphone",
  "message-square",
  "at-sign",
  "share-2",
  "link",
  "briefcase",
  "building",
  "store",
  "banknote",
  "credit-card",
  "wallet",
  "coins",
  "chart-line",
  "chart-bar",
  "trending-up",
  "activity",
  "laptop",
  "monitor",
  "smartphone",
  "cpu",
  "database",
  "server",
  "cloud",
  "code",
  "terminal",
  "bot",
  "settings",
  "wrench",
  "file-text",
  "folder",
  "clipboard-check",
  "pencil",
  "book",
  "library",
  "newspaper",
  "bookmark",
  "search",
  "camera",
  "image",
  "video",
  "mic",
  "headphones",
  "play",
  "home",
  "map",
  "map-pin",
  "plane",
  "car",
  "clock",
  "calendar-check",
  "sun",
  "moon",
  "leaf",
  "mountain",
  "flame",
  "coffee",
  "lock",
  "key",
  "tag",
  "palette",
  "arrow-right",
  "refresh-cw",
  "infinity"
] as const;
export type LandingIcon = (typeof LANDING_ICONS)[number];

/** Internal path ("/register") or absolute https URL – no protocol-relative or javascript: URLs. */
const href = z
  .string()
  .max(500)
  .refine((v) => (v.startsWith("/") ? !v.startsWith("//") : /^https:\/\//.test(v)), {
    message: 'href must be an internal path ("/register") or an https:// URL',
  });

const ctaButton = z.object({ label: z.string().trim().min(1).max(40), href });

const heroSection = z.object({
  type: z.literal("hero"),
  headline: z.string().trim().min(1).max(120),
  subline: z.string().trim().max(300).optional(),
  /** Renders the community logo (or monogram) above the headline. */
  showLogo: z.boolean().default(true),
  primaryCta: ctaButton.optional(),
  secondaryCta: ctaButton.optional(),
  imageMediaId: z.string().uuid().optional(),
});

const featuresSection = z.object({
  type: z.literal("features"),
  title: z.string().trim().max(120).optional(),
  intro: z.string().trim().max(400).optional(),
  items: z
    .array(
      z.object({
        icon: z.enum(LANDING_ICONS),
        title: z.string().trim().min(1).max(80),
        text: z.string().trim().max(400),
      }),
    )
    .min(1)
    .max(9),
});

/** Hub-and-spoke diagram: one central icon, satellites on spokes; a spoke's data stream moves on hover. */
const hubSection = z.object({
  type: z.literal("hub"),
  title: z.string().trim().max(120).optional(),
  intro: z.string().trim().max(400).optional(),
  center: z.object({
    icon: z.enum(LANDING_ICONS),
    label: z.string().trim().min(1).max(40),
  }),
  /** Placed clockwise starting at the top; `flow` sets the direction of the stream shown on hover. */
  nodes: z
    .array(
      z.object({
        icon: z.enum(LANDING_ICONS),
        label: z.string().trim().min(1).max(40),
        text: z.string().trim().max(80).optional(),
        flow: z.enum(["in", "out", "both"]).default("in"),
      }),
    )
    .min(3)
    .max(8),
});

const markdownSection = z.object({
  type: z.literal("markdown"),
  title: z.string().trim().max(120).optional(),
  /** Rendered with the sanitized markdown renderer – raw HTML is stripped. */
  body: z.string().min(1).max(8000),
});

const ctaSection = z.object({
  type: z.literal("cta"),
  headline: z.string().trim().min(1).max(120),
  text: z.string().trim().max(400).optional(),
  button: ctaButton,
});

const faqSection = z.object({
  type: z.literal("faq"),
  title: z.string().trim().max(120).optional(),
  items: z
    .array(z.object({ question: z.string().trim().min(1).max(200), answer: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(20),
});

const imageSection = z.object({
  type: z.literal("image"),
  /** Must reference a media file with purpose "landing" (or "logo") – other purposes are not public. */
  mediaId: z.string().uuid(),
  alt: z.string().trim().min(1).max(200),
  caption: z.string().trim().max(300).optional(),
});

/**
 * Event widgets: seminars and workshops from the operator's event service. The definition only
 * says what to show – the script origin is never part of it (a free URL here would let anyone with
 * `landing:write` run their own JavaScript on a public page). It comes from the "events"
 * integration, see `getEventsWidgetUrl()`.
 */
const eventsSection = z.object({
  type: z.literal("events"),
  title: z.string().trim().max(120).optional(),
  intro: z.string().trim().max(400).optional(),
  when: z.enum(["upcoming", "past", "all"]).default("upcoming"),
  /** Hybrid events match both values. */
  format: z.enum(["online", "onsite"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  /** Shown instead of the list when there is nothing to show. */
  emptyText: z.string().trim().min(1).max(200).optional(),
});

/** Slugs come from the event service, e.g. "2026-11-06-lovable-erste-app". */
const eventSlug = z
  .string()
  .trim()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase letters, digits and single hyphens");

/** One event with description and tickets directly in the page (no dialog). */
const eventSection = z.object({
  type: z.literal("event"),
  slug: eventSlug,
});

/**
 * Result of a purchase. Only visible when the address carries `?session_id=…`, as it does for a
 * buyer returning from the payment – so it can sit on any page, including the landing page.
 */
const orderStatusSection = z.object({
  type: z.literal("order-status"),
});

export const landingSectionSchema = z.discriminatedUnion("type", [
  heroSection,
  featuresSection,
  hubSection,
  markdownSection,
  ctaSection,
  faqSection,
  imageSection,
  eventsSection,
  eventSection,
  orderStatusSection,
]);

/** Section types rendered by the event widgets. */
export const EVENT_SECTION_TYPES = ["events", "event", "order-status"] as const;

/** Widget texts a page may replace; everything else keeps the wording of the event service. */
export const EVENT_TEXT_KEYS = [
  "buy",
  "soldOut",
  "cancelled",
  "priceFrom",
  "tickets",
  "quantity",
  "empty",
  "details",
  "inclTax",
  "paymentNote",
  "statusPaidTitle",
] as const;
export type EventTextKey = (typeof EVENT_TEXT_KEYS)[number];

const eventTexts = z
  .strictObject(Object.fromEntries(EVENT_TEXT_KEYS.map((key) => [key, z.string().trim().min(1).max(200).optional()])) as Record<EventTextKey, z.ZodOptional<z.ZodString>>)
  .refine((texts) => !texts.priceFrom || texts.priceFrom.includes("{price}"), { message: 'priceFrom must contain the placeholder "{price}"', path: ["priceFrom"] });

export const landingDefinitionSchema = z.object({
  meta: z
    .object({
      /** SEO title; falls back to the community name. */
      title: z.string().trim().max(70).optional(),
      /** SEO description; falls back to the tagline. */
      description: z.string().trim().max(160).optional(),
    })
    .default({}),
  sections: z.array(landingSectionSchema).min(1).max(15),
  /** Replaces single texts of the event widgets, for all event sections of the page. */
  eventTexts: eventTexts.optional(),
  footer: z
    .object({
      text: z.string().trim().max(300).optional(),
      /** e.g. Impressum / Datenschutz links – required for public sites in Germany. */
      links: z.array(z.object({ label: z.string().trim().min(1).max(60), href })).max(6).default([]),
    })
    .default({ links: [] }),
});

export type LandingDefinition = z.infer<typeof landingDefinitionSchema>;
export type LandingSection = z.infer<typeof landingSectionSchema>;

export type LandingValidationIssue = { path: string; message: string };
export type LandingValidationResult =
  | { ok: true; definition: LandingDefinition }
  | { ok: false; issues: LandingValidationIssue[] };

export function validateLandingDefinition(input: unknown): LandingValidationResult {
  const parsed = landingDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) };
  }
  return { ok: true, definition: parsed.data };
}

/** Whether the page needs the event service to render completely. */
export function usesEventSections(definition: LandingDefinition): boolean {
  return definition.sections.some((s) => (EVENT_SECTION_TYPES as readonly string[]).includes(s.type));
}

/**
 * Internal links with a fragment ("/#event/<slug>") must be plain anchors: the event list opens
 * its dialog on `hashchange`, which a client-side router navigation never fires.
 */
export function isFragmentHref(href: string): boolean {
  return href.startsWith("/") && href.includes("#");
}

/** All media ids referenced by a definition (hero images + image sections). */
export function collectLandingMediaIds(definition: LandingDefinition): string[] {
  const ids = new Set<string>();
  for (const s of definition.sections) {
    if (s.type === "hero" && s.imageMediaId) ids.add(s.imageMediaId);
    if (s.type === "image") ids.add(s.mediaId);
  }
  return [...ids];
}
