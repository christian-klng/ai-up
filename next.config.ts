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
  // Dev only: allow opening the dev server via 127.0.0.1 as a second "browser identity" for multi-user testing.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default withNextIntl(nextConfig);
