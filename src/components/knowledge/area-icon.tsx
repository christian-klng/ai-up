import { Book, BookOpen, Brain, Code2, Compass, FolderOpen, GraduationCap, Lightbulb, Megaphone, Newspaper, Rocket, Star, Wrench, type LucideProps } from "lucide-react";

export const AREA_ICONS = {
  book: Book,
  "book-open": BookOpen,
  brain: Brain,
  code: Code2,
  compass: Compass,
  folder: FolderOpen,
  "graduation-cap": GraduationCap,
  lightbulb: Lightbulb,
  megaphone: Megaphone,
  newspaper: Newspaper,
  rocket: Rocket,
  star: Star,
  wrench: Wrench,
} as const;

export type AreaIconKey = keyof typeof AREA_ICONS;
export const AREA_ICON_KEYS = Object.keys(AREA_ICONS) as AreaIconKey[];

export function isAreaIconKey(v: unknown): v is AreaIconKey {
  return typeof v === "string" && v in AREA_ICONS;
}

export function AreaIcon({ icon, ...props }: { icon: string } & LucideProps) {
  const Cmp = isAreaIconKey(icon) ? AREA_ICONS[icon] : Book;
  return <Cmp {...props} />;
}
