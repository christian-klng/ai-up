import type { LandingSection } from "@/lib/landing-schema";
import { cn } from "@/lib/utils";
import { LANDING_ICON_MAP } from "./icon-map";

type HubSection = Extract<LandingSection, { type: "hub" }>;

// SVG user space matches the container's 5:4 aspect ratio, so the percent positions of the
// HTML nodes and the stream coordinates line up at every width without distortion.
const W = 500;
const H = 400;
const RX = 0.36;
const RY = 0.34;
/** Perpendicular gap between the two lanes of a "both" stream, in user units. */
const LANE = 4;

function nodePosition(i: number, n: number) {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return { x: 0.5 + RX * Math.cos(angle), y: 0.5 + RY * Math.sin(angle), upper: Math.sin(angle) < -0.01 };
}

/** Dotted line whose dots travel from (x1,y1) to (x2,y2). */
function Stream({ x1, y1, x2, y2, delay }: { x1: number; y1: number; x2: number; y2: number; delay: number }) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      className="animate-hub-flow stroke-primary motion-reduce:animate-none"
      strokeWidth={3}
      strokeLinecap="round"
      strokeDasharray="0.5 17.5"
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

export function HubDiagram({ section, path }: { section: HubSection; path: string }) {
  const CenterIcon = LANDING_ICON_MAP[section.center.icon];
  const cx = W / 2;
  const cy = H / 2;
  const nodes = section.nodes.map((node, i) => ({ ...node, ...nodePosition(i, section.nodes.length) }));
  const withText = nodes.filter((n) => n.text);

  return (
    <section className="py-10">
      {section.title && (
        <h2 className="text-center text-2xl font-semibold tracking-tight text-balance" data-ep={`${path}.title`}>
          {section.title}
        </h2>
      )}
      {section.intro && (
        <p className="mx-auto mt-2 max-w-2xl text-center text-muted-foreground" data-ep={`${path}.intro`}>
          {section.intro}
        </p>
      )}

      <div className="relative mx-auto mt-14 mb-10 aspect-[5/4] w-full max-w-3xl sm:mt-20 sm:mb-16">
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full overflow-visible" aria-hidden>
          {nodes.map((node, i) => {
            const nx = node.x * W;
            const ny = node.y * H;
            const len = Math.hypot(nx - cx, ny - cy) || 1;
            // Unit normal of the spoke, used to split a two-way stream into parallel lanes.
            const ox = (-(ny - cy) / len) * LANE;
            const oy = ((nx - cx) / len) * LANE;
            const delay = -i * 0.37;
            return (
              <g key={i}>
                <line x1={cx} y1={cy} x2={nx} y2={ny} className="stroke-border" strokeWidth={1.5} />
                {node.flow === "in" && <Stream x1={nx} y1={ny} x2={cx} y2={cy} delay={delay} />}
                {node.flow === "out" && <Stream x1={cx} y1={cy} x2={nx} y2={ny} delay={delay} />}
                {node.flow === "both" && (
                  <>
                    <Stream x1={nx + ox} y1={ny + oy} x2={cx + ox} y2={cy + oy} delay={delay} />
                    <Stream x1={cx - ox} y1={cy - oy} x2={nx - ox} y2={ny - oy} delay={delay - 0.45} />
                  </>
                )}
              </g>
            );
          })}
        </svg>

        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-primary/20 [animation-duration:3s] motion-reduce:animate-none" />
          <div className="relative flex size-20 flex-col items-center justify-center gap-1 rounded-full bg-primary text-primary-foreground shadow-lg sm:size-32">
            <CenterIcon className="size-7 sm:size-10" aria-hidden />
            <span className="px-2 text-center text-[11px] leading-tight font-semibold sm:text-sm" data-ep={`${path}.center.label`}>
              {section.center.label}
            </span>
          </div>
        </div>

        <ul className="contents">
          {nodes.map((node, i) => {
            const Icon = LANDING_ICON_MAP[node.icon];
            return (
              <li key={i} className="absolute" style={{ left: `${node.x * 100}%`, top: `${node.y * 100}%` }}>
                <span className="absolute top-1/2 left-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-primary shadow-sm sm:size-12">
                  <Icon className="size-5 sm:size-6" aria-hidden />
                </span>
                <div className={cn("absolute left-1/2 w-24 -translate-x-1/2 text-center sm:w-40", node.upper ? "bottom-6 sm:bottom-8" : "top-6 sm:top-8")}>
                  <p className="text-xs font-semibold sm:text-sm" data-ep={`${path}.nodes.${i}.label`}>
                    {node.label}
                  </p>
                  {node.text && (
                    <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block" data-ep={`${path}.nodes.${i}.text`}>
                      {node.text}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Narrow screens: node texts don't fit around the hub, list them below instead. */}
      {withText.length > 0 && (
        <dl className="mx-auto grid max-w-sm gap-1.5 text-sm sm:hidden">
          {withText.map((node, i) => (
            <div key={i}>
              <dt className="inline font-semibold">{node.label}: </dt>
              <dd className="inline text-muted-foreground">{node.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
