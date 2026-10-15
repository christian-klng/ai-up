import type { LocalAudioTrack } from "livekit-client";
import type { DeepFilterNoiseFilterProcessor } from "deepfilternet3-noise-filter";
import { NOISE_FILTER_ASSET_BASE, suppressionDb, type NoiseFilterLevel } from "@/lib/noise-filter";

const PROCESSOR_NAME = "deepfilternet3-noise-filter";

/**
 * Puts the microphone track on the given level. Between "medium" and "strong" only the attenuation
 * limit changes (no restart, no click); "standard" removes the processor so weak devices are relieved.
 * The package is imported on demand – it stays out of the bundle, and its ~24 MB of WASM + model are
 * only fetched (from our own /vendor, browser-cached) once someone turns the filter on.
 *
 * Throws when the filter can't run here (no AudioWorklet/WASM, asset download failed); the track is
 * left on the browser filter then.
 */
export async function applyNoiseFilter(track: LocalAudioTrack, level: NoiseFilterLevel): Promise<void> {
  const db = suppressionDb(level);
  const current = track.getProcessor();
  if (db === null) {
    if (current) await track.stopProcessor();
    return;
  }
  if (current?.name === PROCESSOR_NAME) {
    (current as DeepFilterNoiseFilterProcessor).setSuppressionLevel(db);
    return;
  }
  const { DeepFilterNoiseFilter, DeepFilterNoiseFilterProcessor } = await import("deepfilternet3-noise-filter");
  if (!DeepFilterNoiseFilterProcessor.isSupported() || typeof AudioWorkletNode === "undefined") {
    throw new Error("Noise filter not supported in this browser");
  }
  const processor = DeepFilterNoiseFilter({ noiseReductionLevel: db, assetConfig: { cdnUrl: NOISE_FILTER_ASSET_BASE } });
  try {
    await track.setProcessor(processor);
  } catch (err) {
    // LiveKit keeps the unprocessed track when init fails; only the half-built audio graph needs closing.
    await processor.destroy().catch(() => {});
    throw err;
  }
}
