import { TemplateIcon } from "@/components/structures/template-icon";
import { cn } from "@/lib/utils";
import type { FileFormat } from "@/lib/file-formats";

/**
 * Desktop-style file icon for the "folder" collection layout: a white sheet
 * with a dog-eared corner, the template glyph and a coloured format band.
 * The sheet stays light in both themes — the way macOS and Windows keep
 * document icons light on a dark desktop — just dimmed a little in dark mode.
 * Decorative: the entry title sits next to it, so the icon is aria-hidden.
 */
export function FileIcon({ format, icon, size = 56, className }: { format: FileFormat; icon: string; size?: number; className?: string }) {
  const hasBand = format.code.length > 0;
  return (
    <svg
      viewBox="0 0 48 60"
      width={size}
      height={(size / 48) * 60}
      className={cn("drop-shadow-sm", className)}
      aria-hidden
    >
      {/* sheet with the top-right corner cut away for the fold */}
      <path
        d="M9 2h22l12 12v40a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z"
        className="fill-white stroke-black/10 dark:fill-neutral-200 dark:stroke-black/30"
        strokeWidth={1}
      />
      {/* folded corner, a shade darker than the sheet */}
      <path d="M31 2l12 12H31z" className="fill-black/10 dark:fill-black/20" />
      <path d="M31 2v12h12" className="stroke-black/15 dark:stroke-black/25" strokeWidth={1} fill="none" />
      <TemplateIcon
        icon={icon}
        x={hasBand ? 15 : 14}
        y={hasBand ? 14 : 20}
        width={hasBand ? 18 : 20}
        height={hasBand ? 18 : 20}
        stroke={format.color}
        strokeWidth={2}
        opacity={0.75}
      />
      {hasBand && (
        <>
          <rect x={9} y={39} width={30} height={13} rx={3} fill={format.color} />
          <text x={24} y={45.9} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={9} fontWeight={700} letterSpacing={0.4}>
            {format.code}
          </text>
        </>
      )}
    </svg>
  );
}
