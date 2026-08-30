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

export const landingSectionSchema = z.discriminatedUnion("type", [
  heroSection,
  featuresSection,
  markdownSection,
  ctaSection,
  faqSection,
  imageSection,
]);

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

/** All media ids referenced by a definition (hero images + image sections). */
export function collectLandingMediaIds(definition: LandingDefinition): string[] {
  const ids = new Set<string>();
  for (const s of definition.sections) {
    if (s.type === "hero" && s.imageMediaId) ids.add(s.imageMediaId);
    if (s.type === "image") ids.add(s.mediaId);
  }
  return [...ids];
}
