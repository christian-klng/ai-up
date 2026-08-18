import type { ThemeSettings } from "@/server/db/schema";

/**
 * Converts the admin's primary color into the CSS custom properties consumed by the shadcn/Tailwind tokens.
 * Colors are expressed in OKLCH so lightness adjustments for dark mode stay perceptually even.
 */

type Oklch = { l: number; c: number; h: number };

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToOklch(hex: string): Oklch {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = parseInt(m ? m[1] : "2563eb", 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);

  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.sqrt(a * a + bb * bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h: Number.isFinite(h) ? h : 0 };
}

const fmt = ({ l, c, h }: Oklch) => `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;

export function isValidHexColor(v: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(v);
}

/** CSS text for :root and .dark overriding the brand-dependent tokens. */
export function themeCss(theme: ThemeSettings): string {
  const base = hexToOklch(theme.primaryColor);
  const light = { ...base, l: Math.min(Math.max(base.l, 0.35), 0.62) };
  const dark = { ...base, l: Math.min(Math.max(base.l + 0.12, 0.62), 0.8), c: Math.min(base.c, 0.2) };
  const fgLight = light.l > 0.66 ? "oklch(0.15 0 0)" : "oklch(0.985 0 0)";
  const fgDark = dark.l > 0.66 ? "oklch(0.15 0 0)" : "oklch(0.985 0 0)";
  const radius = `${Math.min(Math.max(theme.radius, 0), 1.5)}rem`;
  const tint = (l: number, c: number) => fmt({ l, c: Math.min(c, 0.05), h: base.h });

  return `:root{--primary:${fmt(light)};--primary-foreground:${fgLight};--ring:${fmt({ ...light, c: light.c * 0.6 })};--sidebar-primary:${fmt(light)};--sidebar-primary-foreground:${fgLight};--chart-1:${fmt(light)};--radius:${radius};--accent:${tint(0.96, base.c * 0.25)};--sidebar-accent:${tint(0.95, base.c * 0.25)};--muted:${tint(0.965, base.c * 0.15)};--sidebar:${tint(0.985, base.c * 0.1)}}
.dark{--primary:${fmt(dark)};--primary-foreground:${fgDark};--ring:${fmt({ ...dark, c: dark.c * 0.6 })};--sidebar-primary:${fmt(dark)};--sidebar-primary-foreground:${fgDark};--chart-1:${fmt(dark)};--accent:${tint(0.27, base.c * 0.2)};--sidebar-accent:${tint(0.26, base.c * 0.2)};--muted:${tint(0.26, base.c * 0.12)};--sidebar:${tint(0.19, base.c * 0.1)}}`;
}
