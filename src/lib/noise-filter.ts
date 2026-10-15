/**
 * Noise filter levels for the own microphone in a call (docs/rauschunterdrueckung.md).
 * "standard" is the browser's built-in WebRTC suppression only; the others add DeepFilterNet3.
 */
export const NOISE_FILTER_LEVELS = ["standard", "medium", "strong"] as const;
export type NoiseFilterLevel = (typeof NOISE_FILTER_LEVELS)[number];

/** Per device, not per account: whether the filter runs smoothly depends on the machine. */
export const NOISE_FILTER_STORAGE_KEY = "aiup_noise_filter";
export const DEFAULT_NOISE_FILTER_LEVEL: NoiseFilterLevel = "standard";

/** Where scripts/fetch-noise-filter-assets.mjs puts WASM + model; keep the version in sync with it. */
export const NOISE_FILTER_ASSET_BASE = "/vendor/deepfilternet3/1.3.0";

/**
 * DeepFilterNet's attenuation limit in dB: noise is lowered by at most this much (100 = unlimited).
 * A limit keeps some room tone and makes the voice sound less processed. `null` = no DeepFilterNet.
 */
export function suppressionDb(level: NoiseFilterLevel): number | null {
  switch (level) {
    case "standard":
      return null;
    case "medium":
      return 25;
    case "strong":
      return 100;
  }
}

export function parseNoiseFilterLevel(raw: unknown): NoiseFilterLevel {
  return NOISE_FILTER_LEVELS.includes(raw as NoiseFilterLevel) ? (raw as NoiseFilterLevel) : DEFAULT_NOISE_FILTER_LEVEL;
}
