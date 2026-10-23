import { ChevronDown, ChevronRight, Image as ImageIcon, MousePointer2, Play } from "lucide-react";
import type { LandingPreview } from "@/lib/landing-schema";
import { cn } from "@/lib/utils";

/**
 * Decorative mockups of the content templates for feature cards. Placeholder lines instead of
 * words keep them language-neutral; colors come from the theme plus the sticky-note/card palette
 * the real editors use, so they read as the same thing.
 */

/** A placeholder text line; `w` is a Tailwind width class. */
function Line({ w, className }: { w: string; className?: string }) {
  return <span className={cn("block h-1.5 rounded-full bg-foreground/15", w, className)} />;
}

function Whiteboard() {
  return (
    <div className="relative h-full bg-card *:absolute">
      <div
        className="inset-0"
        style={{ backgroundImage: "radial-gradient(color-mix(in oklch, var(--muted-foreground) 35%, transparent) 1px, transparent 1px)", backgroundSize: "12px 12px" }}
      />
      <div className="top-3 left-3 h-[58%] w-[54%] rounded-md border-2 border-dashed border-sky-500/60 bg-sky-400/10" />
      <div className="top-6 left-6 flex h-14 w-16 -rotate-3 flex-col gap-1.5 rounded-sm bg-amber-200 p-2 shadow-sm dark:bg-amber-300">
        <Line w="w-full" className="bg-black/20" />
        <Line w="w-2/3" className="bg-black/20" />
      </div>
      <div className="top-9 left-[6.5rem] flex h-14 w-16 rotate-2 flex-col gap-1.5 rounded-sm bg-rose-200 p-2 shadow-sm dark:bg-rose-300">
        <Line w="w-full" className="bg-black/20" />
        <Line w="w-1/2" className="bg-black/20" />
      </div>
      <div className="top-5 right-4 flex h-12 w-14 rotate-3 flex-col gap-1.5 rounded-sm bg-emerald-200 p-2 shadow-sm dark:bg-emerald-300">
        <Line w="w-full" className="bg-black/20" />
        <Line w="w-3/4" className="bg-black/20" />
      </div>
      <div className="right-6 bottom-4 flex h-12 w-20 items-center justify-center rounded-md border bg-muted">
        <ImageIcon className="size-5 text-muted-foreground" />
      </div>
      <div className="bottom-5 left-[42%] flex items-start">
        <MousePointer2 className="size-4 fill-sky-500 text-sky-600" />
        <span className="mt-3 -ml-0.5 h-3 w-9 rounded-sm bg-sky-500" />
      </div>
    </div>
  );
}

const KANBAN_COLUMNS = [
  ["bg-sky-500", "bg-rose-500"],
  ["bg-emerald-500", "bg-violet-500"],
  ["bg-amber-500"],
];

function Kanban() {
  return (
    <div className="grid h-full grid-cols-3 gap-2 bg-card p-3">
      {KANBAN_COLUMNS.map((cards, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-md bg-muted p-1.5">
          <Line w="w-1/2" className="mb-0.5 h-2 bg-foreground/25" />
          {cards.map((color, j) => (
            <div key={j} className={cn("flex flex-col gap-1 rounded border bg-card p-1.5 shadow-xs", i === 1 && j === 0 && "translate-x-1 -rotate-2 shadow-md")}>
              <span className={cn("block h-1 w-5 rounded-full", color)} />
              <Line w="w-full" />
              <Line w="w-2/3" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Article() {
  return (
    <div className="flex h-full gap-3 bg-card p-3">
      <div className="flex flex-1 flex-col gap-1.5">
        <Line w="w-4/5" className="h-2.5 bg-foreground/35" />
        <Line w="w-1/3" className="mb-1 bg-foreground/10" />
        <Line w="w-full" />
        <Line w="w-full" />
        <Line w="w-11/12" />
        <span className="block h-1.5 w-2/5 rounded-full bg-primary/60" />
        <Line w="w-full" className="mt-1" />
        <Line w="w-3/4" />
      </div>
      <div className="flex w-2/5 items-center justify-center self-start rounded-md bg-linear-to-br from-sky-400/30 to-emerald-400/30 py-7">
        <ImageIcon className="size-5 text-foreground/40" />
      </div>
    </div>
  );
}

function Video() {
  return (
    <div className="flex h-full flex-col gap-2 bg-card p-3">
      <div className="relative flex flex-1 items-center justify-center rounded-md bg-linear-to-br from-zinc-700 to-zinc-900">
        <span className="flex size-9 items-center justify-center rounded-full bg-white/90 shadow">
          <Play className="ml-0.5 size-4 fill-zinc-900 text-zinc-900" />
        </span>
        <div className="absolute inset-x-2.5 bottom-2 h-1 rounded-full bg-white/25">
          <div className="h-full w-2/5 rounded-full bg-primary" />
        </div>
      </div>
      <Line w="w-3/5" className="h-2 bg-foreground/30" />
      <Line w="w-4/5" />
    </div>
  );
}

const GALLERY_TILES = [
  "col-span-2 row-span-2 from-sky-400/40 to-violet-400/40",
  "from-amber-300/50 to-rose-400/40",
  "from-emerald-300/50 to-sky-400/40",
  "from-rose-300/50 to-amber-300/40",
  "from-violet-300/50 to-emerald-300/40",
];

function Gallery() {
  return (
    <div className="grid h-full grid-cols-4 grid-rows-2 gap-1.5 bg-card p-3">
      {GALLERY_TILES.map((tile, i) => (
        <div key={i} className={cn("flex items-end rounded-md bg-linear-to-br p-1.5", tile)}>
          {i === 0 && <ImageIcon className="size-4 text-foreground/40" />}
        </div>
      ))}
    </div>
  );
}

function List() {
  return (
    <div className="flex h-full flex-col gap-1.5 bg-card p-3">
      <div className="rounded-md border px-2 py-1.5">
        <div className="flex items-center justify-between">
          <Line w="w-2/5" className="bg-foreground/30" />
          <ChevronDown className="size-3 text-muted-foreground" />
        </div>
        <div className="mt-1.5 flex flex-col gap-1">
          <Line w="w-full" />
          <Line w="w-3/4" />
        </div>
      </div>
      <div className="flex items-center justify-between rounded-md border px-2 py-1.5">
        <Line w="w-1/2" className="bg-foreground/30" />
        <ChevronRight className="size-3 text-muted-foreground" />
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="flex size-3 items-center justify-center rounded-[3px] bg-primary">
          <span className="size-1.5 rounded-[1px] bg-primary-foreground" />
        </span>
        <Line w="w-1/4" />
        <span className="ml-auto h-3.5 w-9 rounded-full bg-primary/15" />
        <span className="h-3.5 w-7 rounded-full border" />
      </div>
    </div>
  );
}

function Process() {
  // viewBox units; the start/decision tints match the process editor.
  return (
    <div className="h-full bg-card p-2">
      <svg viewBox="0 0 240 120" className="size-full" aria-hidden>
        <g className="fill-none stroke-foreground/30" strokeWidth="1.5">
          <path d="M44 60 H70" />
          <path d="M110 60 H122" />
          <path d="M160 60 H168 V30 H178" />
          <path d="M168 60 V90 H178" />
        </g>
        <g className="fill-foreground/30">
          <path d="M70 56 l6 4 -6 4z" />
          <path d="M122 56 l6 4 -6 4z" />
          <path d="M178 26 l6 4 -6 4z" />
          <path d="M178 86 l6 4 -6 4z" />
        </g>
        <rect x="8" y="48" width="36" height="24" rx="12" className="fill-emerald-500/15 stroke-emerald-500/70" strokeWidth="1.5" />
        <rect x="76" y="46" width="34" height="28" rx="5" className="fill-muted stroke-foreground/30" strokeWidth="1.5" />
        <path d="M144 44 L160 60 L144 76 L128 60 Z" className="fill-amber-500/15 stroke-amber-500/70" strokeWidth="1.5" />
        <rect x="184" y="18" width="48" height="24" rx="5" className="fill-muted stroke-foreground/30" strokeWidth="1.5" />
        <rect x="184" y="78" width="48" height="24" rx="5" className="fill-muted stroke-foreground/30" strokeWidth="1.5" />
        <g className="fill-foreground/20">
          <rect x="83" y="57" width="20" height="4" rx="2" />
          <rect x="191" y="28" width="34" height="4" rx="2" />
          <rect x="191" y="88" width="26" height="4" rx="2" />
        </g>
      </svg>
    </div>
  );
}

const PREVIEWS: Record<LandingPreview, () => React.JSX.Element> = {
  whiteboard: Whiteboard,
  kanban: Kanban,
  article: Article,
  video: Video,
  gallery: Gallery,
  list: List,
  process: Process,
};

export function FeaturePreview({ preview }: { preview: LandingPreview }) {
  const Preview = PREVIEWS[preview];
  return (
    <div className="h-36 overflow-hidden rounded-lg border select-none" aria-hidden>
      <Preview />
    </div>
  );
}
