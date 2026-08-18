import type { AppSettings } from "@/server/db/schema";

/** Logo from settings, or a monogram fallback derived from the app name. */
export function BrandLogo({ settings, size = 32 }: { settings: Pick<AppSettings, "name" | "logoMediaId">; size?: number }) {
  if (settings.logoMediaId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/files/${settings.logoMediaId}`}
        alt={settings.name}
        width={size}
        height={size}
        className="rounded-md object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  const initials = settings.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden
    >
      {initials || "A"}
    </span>
  );
}
