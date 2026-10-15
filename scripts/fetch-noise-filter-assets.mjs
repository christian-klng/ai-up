// Downloads the DeepFilterNet3 WASM + model for the call noise filter into public/vendor/ so the browser
// loads them from our own host instead of the package author's CDN (docs/rauschunterdrueckung.md).
// Runs as prebuild/predev; skips files that are already present with the right hash.
//
// The WASM must match the wasm-bindgen glue embedded in the npm package, so a package upgrade means:
// new VERSION here and in src/lib/noise-filter.ts, new hashes (the script refuses to run otherwise).
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1.3.0";
const SOURCE = "https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3";
const ASSETS = [
  { path: "v3/pkg/df_bg.wasm", sha256: "440b5d12b6ea7d95008736f844221d7874ee15de5cb10d3015002470fdba0432" },
  { path: "v3/models/DeepFilterNet3_onnx.tar.gz", sha256: "c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616" },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "public", "vendor", "deepfilternet3", VERSION);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

if (process.env.SKIP_NOISE_FILTER_ASSETS === "1") {
  console.log("[noise-filter] SKIP_NOISE_FILTER_ASSETS=1, not fetching assets");
  process.exit(0);
}

const installed = JSON.parse(await readFile(join(root, "node_modules", "deepfilternet3-noise-filter", "package.json"), "utf8")).version;
if (installed !== VERSION) {
  console.error(`[noise-filter] deepfilternet3-noise-filter ${installed} is installed, assets are pinned to ${VERSION}. Update VERSION and hashes.`);
  process.exit(1);
}

for (const asset of ASSETS) {
  const file = join(target, asset.path);
  const existing = await readFile(file).catch(() => null);
  if (existing && sha256(existing) === asset.sha256) continue;

  const res = await fetch(`${SOURCE}/${asset.path}`);
  if (!res.ok) {
    console.error(`[noise-filter] ${asset.path}: HTTP ${res.status}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = sha256(buf);
  if (hash !== asset.sha256) {
    console.error(`[noise-filter] ${asset.path}: hash mismatch (got ${hash}, expected ${asset.sha256})`);
    process.exit(1);
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, buf);
  await rename(`${file}.tmp`, file);
  console.log(`[noise-filter] fetched ${asset.path} (${(buf.length / 1e6).toFixed(1)} MB)`);
}
