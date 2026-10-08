"use client";

import { useState } from "react";
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

/** Dotted line whose dots travel from (x1,y1) to (x2,y2) – only while `active`, the diagram is still otherwise. */
function Stream({ x1, y1, x2, y2, active }: { x1: number; y1: number; x2: number; y2: number; active: boolean }) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      className={cn("stroke-primary transition-opacity duration-300", active ? "animate-hub-flow opacity-100 motion-reduce:animate-none" : "opacity-0")}
      strokeWidth={3}
      strokeLinecap="round"
      strokeDasharray="0.5 17.5"
    />
  );
}

export function HubDiagram({ section, path }: { section: HubSection; path: string }) {
  const CenterIcon = LANDING_ICON_MAP[section.center.icon];
  const cx = W / 2;
  const cy = H / 2;
  const nodes = section.nodes.map((node, i) => ({ ...node, ...nodePosition(i, section.nodes.length) }));
  const withText = nodes.filter((n) => n.text);
  // The spoke of the hovered node shows its stream; nothing moves on its own.
  const [hovered, setHovered] = useState<number | null>(null);

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

      <div className="relative mx-auto mt-14 mb-10 aspect-[5/4] w-full max-w-2xl sm:mt-20 sm:mb-16">
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full overflow-visible" aria-hidden>
          {nodes.map((node, i) => {
            const nx = node.x * W;
            const ny = node.y * H;
            const len = Math.hypot(nx - cx, ny - cy) || 1;
            // Unit normal of the spoke, used to split a two-way stream into parallel lanes.
            const ox = (-(ny - cy) / len) * LANE;
            const oy = ((nx - cx) / len) * LANE;
            const active = hovered === i;
            return (
              <g key={i}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={nx}
                  y2={ny}
                  className={cn("transition-colors duration-300", active ? "stroke-primary/30" : "stroke-border")}
                  strokeWidth={1.5}
                />
                {node.flow === "in" && <Stream x1={nx} y1={ny} x2={cx} y2={cy} active={active} />}
                {node.flow === "out" && <Stream x1={cx} y1={cy} x2={nx} y2={ny} active={active} />}
                {node.flow === "both" && (
                  <>
                    <Stream x1={nx + ox} y1={ny + oy} x2={cx + ox} y2={cy + oy} active={active} />
                    <Stream x1={cx - ox} y1={cy - oy} x2={nx - ox} y2={ny - oy} active={active} />
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
            return (
              <li
                key={i}
                className="group absolute"
                style={{ left: `${node.x * 100}%`, top: `${node.y * 100}%` }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((current) => (current === i ? null : current))}
              >
                <span className="absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-primary shadow-sm transition-[transform,box-shadow,border-color] duration-300 group-hover:scale-110 group-hover:border-primary/50 group-hover:shadow-md motion-reduce:transition-none sm:size-16">
                  <Icon className="size-6 sm:size-7" aria-hidden />
                </span>
                <div className={cn("absolute left-1/2 w-28 -translate-x-1/2 text-center sm:w-44", node.upper ? "bottom-8 sm:bottom-10" : "top-8 sm:top-10")}>
                  <p className="text-sm font-semibold transition-colors duration-300 group-hover:text-primary sm:text-base" data-ep={`${path}.nodes.${i}.label`}>
                    {node.label}
                  </p>
                  {node.text && (
                    <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block sm:text-sm" data-ep={`${path}.nodes.${i}.text`}>
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
