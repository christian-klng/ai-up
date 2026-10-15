"use client";

import { useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";
import { useCall } from "@/components/meetings/call-provider";
import { NOISE_FILTER_LEVELS } from "@/lib/noise-filter";

/**
 * Panel behind the control bar's settings button. Only the noise filter lives here so far
 * (docs/rauschunterdrueckung.md). Styled with LiveKit's theme variables but Tailwind classes, not
 * `lk-button`: LiveKit's styles are unlayered and would override every utility.
 */
export function CallSettings({ onClose }: { onClose: () => void }) {
  const t = useTranslations("meetings.call.noiseFilter");
  const { noiseFilter, noiseFilterStatus, setNoiseFilter } = useCall();

  return (
    <div
      role="dialog"
      aria-label={t("title")}
      className="absolute bottom-[calc(var(--lk-control-bar-height)+0.5rem)] left-1/2 z-10 w-[min(26rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-[var(--lk-border-color)] bg-[var(--lk-bg2)] p-3 text-[var(--lk-fg)] shadow-lg"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <button type="button" onClick={onClose} aria-label={t("close")} className="rounded-md p-1 opacity-70 hover:bg-[var(--lk-bg3)] hover:opacity-100">
          <X className="size-4" />
        </button>
      </div>
      <p className="mb-3 text-xs opacity-70">{t("hint")}</p>
      <div className="flex flex-col gap-1" role="radiogroup" aria-label={t("title")}>
        {NOISE_FILTER_LEVELS.map((level) => {
          const selected = noiseFilter === level;
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setNoiseFilter(level)}
              className={`flex flex-col items-start rounded-lg px-3 py-2 text-left ${selected ? "bg-[var(--lk-accent-bg)] text-[var(--lk-accent-fg)]" : "hover:bg-[var(--lk-bg3)]"}`}
            >
              <span className="text-sm font-medium">{t(`levels.${level}.label`)}</span>
              <span className="text-xs opacity-80">{t(`levels.${level}.description`)}</span>
            </button>
          );
        })}
      </div>
      {noiseFilterStatus === "loading" && (
        <p className="mt-3 flex items-center gap-2 text-xs opacity-70">
          <Loader2 className="size-3.5 animate-spin" /> {t("loading")}
        </p>
      )}
      {noiseFilterStatus === "failed" && <p className="mt-3 text-xs text-[var(--lk-danger)]">{t("failed")}</p>}
    </div>
  );
}
