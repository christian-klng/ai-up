import { FileText, Image as ImageIcon, Link2, ListChecks, type LucideProps } from "lucide-react";
import { AREA_ICONS, isAreaIconKey } from "@/components/knowledge/area-icon";

// Template icons: the collection icon set plus the system-template keys.
const TEMPLATE_ICONS = {
  ...AREA_ICONS,
  "file-text": FileText,
  image: ImageIcon,
  "link-2": Link2,
  "list-checks": ListChecks,
} as const;

export type TemplateIconKey = keyof typeof TEMPLATE_ICONS;
export const TEMPLATE_ICON_KEYS = Object.keys(TEMPLATE_ICONS) as TemplateIconKey[];

export function TemplateIcon({ icon, ...props }: { icon: string } & LucideProps) {
  const Cmp = icon in TEMPLATE_ICONS ? TEMPLATE_ICONS[icon as TemplateIconKey] : isAreaIconKey(icon) ? AREA_ICONS[icon] : FileText;
  return <Cmp {...props} />;
}
