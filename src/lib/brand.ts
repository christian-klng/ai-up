import { hexToOklch, isValidHexColor } from "./theme";

/**
 * Branding bits shared by the app shell and the mails: the monogram that stands in for a missing
 * logo, and the colors a mail may use – mails cannot load the theme, so they get plain hex values.
 */

/** Up to two initials of the community name, e.g. "KI-Netzwerk Test" → "KT"; "A" when the name has none. */
export function brandInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return initials || "A";
}

export type MailBrandColors = {
  /** Brand color for buttons and the monogram */
  color: string;
  /** Text on top of it – dark on a light brand color, white otherwise */
  foreground: string;
};

const NEUTRAL = "#111827";

/** Colors for a mail from the community's primary color; an unusable value falls back to neutral dark. */
export function mailBrandColors(primaryColor: string | undefined): MailBrandColors {
  const color = primaryColor && isValidHexColor(primaryColor) ? primaryColor.toLowerCase() : NEUTRAL;
  // Same threshold as the app theme (themeCss) for the primary foreground.
  return { color, foreground: hexToOklch(color).l > 0.66 ? NEUTRAL : "#ffffff" };
}
