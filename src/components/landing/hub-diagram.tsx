"use client";

import { useEffect, useRef, useState } from "react";
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
/** How long the tour rests on one node. */
const STEP_MS = 4000;
/** A tap pauses the tour this long (touch has no pointerleave that would resume it). */
const TOUCH_HOLD_MS = 10000;

function nodePosition(i: number, n: number) {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return { x: 0.5 + RX * Math.cos(angle), y: 0.5 + RY * Math.sin(angle), upper: Math.sin(angle) < -0.01 };
}

/** Dotted line whose dots travel from (x1,y1) to (x2,y2) – only while `active`. */
function Stream({ x1, y1, x2, y2, active }: { x1: number; y1: number; x2: number; y2: number; active: boolean }) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      className={cn("stroke-primary transition-opacity duration-500", active ? "animate-hub-flow opacity-100 motion-reduce:animate-none" : "opacity-0")}
      strokeWidth={3}
      strokeLinecap="round"
      strokeDasharray="0.5 17.5"
    />
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Whether the element is on screen and the tab is visible – the tour only runs while someone can see it. */
function useOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    const onVisibility = () => setPageVisible(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ref]);
  return inView && pageVisible;
}

/**
 * Hub-and-spoke diagram with a calm tour: one node after the other lights up, its spoke shows the
 * data stream and its text appears in the card beside the diagram. Pointing at or tapping a node
 * holds the tour there; reduced motion and the inline editor keep it still.
 */
export function HubDiagram({ section, path, editing }: { section: HubSection; path: string; editing?: boolean }) {
  const CenterIcon = LANDING_ICON_MAP[section.center.icon];
  const cx = W / 2;
  const cy = H / 2;
  const nodes = section.nodes.map((node, i) => ({ ...node, ...nodePosition(i, section.nodes.length) }));

  const rootRef = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(rootRef);
  const reducedMotion = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = onScreen && !held && !reducedMotion && !editing;

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setActive((i) => (i + 1) % nodes.length), STEP_MS);
    return () => clearTimeout(t);
  }, [running, active, nodes.length]);

  useEffect(() => () => {
    if (touchTimer.current) clearTimeout(touchTimer.current);
  }, []);

  const select = (i: number, pointerType?: string) => {
    setActive(i);
    setHeld(true);
    if (touchTimer.current) clearTimeout(touchTimer.current);
    if (pointerType === "touch" || pointerType === "pen") touchTimer.current = setTimeout(() => setHeld(false), TOUCH_HOLD_MS);
  };

  const current = nodes[Math.min(active, nodes.length - 1)];
  const CurrentIcon = LANDING_ICON_MAP[current.icon];
  const cardId = `${path}-detail`;

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

      <div
        ref={rootRef}
        className="mx-auto mt-8 grid max-w-5xl items-center gap-2 md:mt-12 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:gap-10"
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setHeld(false);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
        }}
      >
        <div className="relative mx-auto my-8 aspect-[5/4] w-full max-w-xl">
          <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full overflow-visible" aria-hidden>
            {nodes.map((node, i) => {
              const nx = node.x * W;
              const ny = node.y * H;
              const len = Math.hypot(nx - cx, ny - cy) || 1;
              // Unit normal of the spoke, used to split a two-way stream into parallel lanes.
              const ox = (-(ny - cy) / len) * LANE;
              const oy = ((nx - cx) / len) * LANE;
              const on = active === i;
              return (
                <g key={i}>
                  <line
                    x1={cx}
                    y1={cy}
                    x2={nx}
                    y2={ny}
                    className={cn("transition-colors duration-500", on ? "stroke-primary/30" : "stroke-border")}
                    strokeWidth={1.5}
                  />
                  {node.flow === "in" && <Stream x1={nx} y1={ny} x2={cx} y2={cy} active={on} />}
                  {node.flow === "out" && <Stream x1={cx} y1={cy} x2={nx} y2={ny} active={on} />}
                  {node.flow === "both" && (
                    <>
                      <Stream x1={nx + ox} y1={ny + oy} x2={cx + ox} y2={cy + oy} active={on} />
                      <Stream x1={cx - ox} y1={cy - oy} x2={nx - ox} y2={ny - oy} active={on} />
                    </>
                  )}
                </g>
              );
            })}
          </svg>

          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <span aria-hidden className="absolute -inset-3 rounded-full bg-primary/10" />
            <div className="relative flex size-20 flex-col items-center justify-center gap-1 rounded-full bg-primary text-primary-foreground shadow-lg sm:size-28">
              <CenterIcon className="size-7 sm:size-9" aria-hidden />
              <span className="px-2 text-center text-[11px] leading-tight font-semibold sm:text-sm" data-ep={`${path}.center.label`}>
                {section.center.label}
              </span>
            </div>
          </div>

          <ul className="contents">
            {nodes.map((node, i) => {
              const Icon = LANDING_ICON_MAP[node.icon];
              const on = active === i;
              return (
                <li key={i} className="absolute" style={{ left: `${node.x * 100}%`, top: `${node.y * 100}%` }}>
                  <button
                    type="button"
                    aria-label={node.label}
                    aria-pressed={on}
                    aria-controls={cardId}
                    onPointerEnter={(e) => {
                      if (e.pointerType === "mouse") select(i, "mouse");
                    }}
                    onPointerDown={(e) => select(i, e.pointerType)}
                    onFocus={(e) => {
                      // Keyboard only – a tap focuses too and must keep the hold timer of its pointerdown.
                      if (e.currentTarget.matches(":focus-visible")) select(i);
                    }}
                    className={cn(
                      "absolute top-1/2 left-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border shadow-sm transition-[transform,background-color,color,border-color,box-shadow] duration-500 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none sm:size-16",
                      on ? "scale-110 border-primary bg-primary text-primary-foreground shadow-md" : "bg-card text-primary hover:border-primary/50",
                    )}
                  >
                    <Icon className="size-5 sm:size-7" aria-hidden />
                  </button>
                  <p
                    className={cn(
                      "absolute left-1/2 w-24 -translate-x-1/2 text-center text-xs font-semibold transition-colors duration-500 sm:w-32 sm:text-base",
                      node.upper ? "bottom-7 sm:bottom-10" : "top-7 sm:top-10",
                      on ? "text-primary" : "text-foreground",
                    )}
                    data-ep={`${path}.nodes.${i}.label`}
                  >
                    {node.label}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>

        <div id={cardId} className="mx-auto w-full max-w-md rounded-xl border bg-card p-5 shadow-sm sm:p-6" aria-live={held ? "polite" : "off"}>
          <div key={active} className="flex min-h-36 flex-col gap-3 animate-in fade-in slide-in-from-bottom-1 duration-500 motion-reduce:animate-none">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <CurrentIcon className="size-5" aria-hidden />
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {active + 1} / {nodes.length}
              </span>
            </div>
            <h3 className="text-lg font-semibold" data-ep={`${path}.nodes.${active}.label`}>
              {current.label}
            </h3>
            {current.text && (
              <p className="text-muted-foreground" data-ep={`${path}.nodes.${active}.text`}>
                {current.text}
              </p>
            )}
          </div>
          <div className="mt-5 flex gap-1.5" aria-hidden>
            {nodes.map((_, i) => (
              <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                {i === active && (
                  <span
                    key={`${active}-${running}`}
                    className={cn("block h-full origin-left rounded-full bg-primary", running && "animate-hub-progress")}
                    style={running ? { animationDuration: `${STEP_MS}ms` } : undefined}
                  />
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
