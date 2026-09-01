import { CalendarClock, Code2, Compass, FolderOpen, Presentation, type LucideProps } from "lucide-react";
import { LANDING_ICON_MAP } from "@/components/landing/icon-map";

/**
 * Icons selectable for collections and meeting spaces: the shared site-page icon set
 * plus a few legacy keys/looks kept for existing areas (calendar, code, folder render
 * their original variants; compass and presentation predate the shared set).
 */
export const AREA_ICONS = {
  ...LANDING_ICON_MAP,
  calendar: CalendarClock,
  code: Code2,
  compass: Compass,
  folder: FolderOpen,
  presentation: Presentation,
} as const;

export type AreaIconKey = keyof typeof AREA_ICONS;
export const AREA_ICON_KEYS = Object.keys(AREA_ICONS) as AreaIconKey[];

export function isAreaIconKey(v: unknown): v is AreaIconKey {
  return typeof v === "string" && v in AREA_ICONS;
}

export function AreaIcon({ icon, ...props }: { icon: string } & LucideProps) {
  const Cmp = isAreaIconKey(icon) ? AREA_ICONS[icon] : AREA_ICONS.book;
  return <Cmp {...props} />;
}
