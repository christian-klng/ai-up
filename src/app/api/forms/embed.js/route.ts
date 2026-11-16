import { FORM_EMBED_SCRIPT } from "@/lib/form-embed-script";

/**
 * Embed script for collection forms on other websites (docs/externe-formulare.md 3). Served from a
 * route rather than /public so it sits next to the form API under the one public prefix
 * `/api/forms` – and so the proxy lets it through without a session.
 */
export function GET() {
  return new Response(FORM_EMBED_SCRIPT, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}
