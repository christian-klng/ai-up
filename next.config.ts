import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // Native / Node-only packages must not be bundled into server chunks.
  serverExternalPackages: ["pino", "pino-pretty", "sharp", "pg", "bullmq", "ioredis", "nodemailer"],
  experimental: {
    serverActions: {
      // Server actions carry small form payloads only; media goes through /api/upload.
      bodySizeLimit: "5mb",
    },
  },
  images: {
    // Media is served through our own authenticated route; no remote loaders needed.
    unoptimized: true,
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        // DeepFilterNet3 WASM + model for the call noise filter (~24 MB). The path carries the package
        // version (scripts/fetch-noise-filter-assets.mjs), so browsers may keep them forever.
        source: "/vendor/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  // Dev only: allow opening the dev server via 127.0.0.1 as a second "browser identity" for multi-user testing.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default withNextIntl(nextConfig);
