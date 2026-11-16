import { clientIp } from "@/lib/community-creation";
import { FORM_MAX_BODY_BYTES, formSubmissionSchema, type FormSubmitError } from "@/lib/collection-forms";
import { resolveForm, submitForm } from "@/server/domain/collection-forms";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const STATUS: Record<FormSubmitError, number> = { invalid: 422, contact: 422, closed: 404, tooFast: 429, expired: 409, rateLimited: 429, unexpected: 500 };

function fail(code: FormSubmitError, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, code, ...extra }, { status: STATUS[code] });
}

/**
 * A submission through a collection's public form (docs/externe-formulare.md). No session, no
 * cookie: the token in the path names the form, everything else is checked in submitForm().
 */
export async function POST(req: Request, ctx: RouteContext<"/api/forms/[token]/submissions">) {
  const { token } = await ctx.params;
  try {
    if (Number(req.headers.get("content-length") ?? 0) > FORM_MAX_BODY_BYTES) return fail("invalid");
    const raw = await req.text();
    if (raw.length > FORM_MAX_BODY_BYTES) return fail("invalid");
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail("invalid");
    }
    const parsed = formSubmissionSchema.safeParse(json);
    if (!parsed.success) {
      // A missing title is the one schema error a person can cause and fix.
      const titleMissing = parsed.error.issues.some((i) => i.path[0] === "title");
      return fail("invalid", titleMissing ? { issues: [{ key: "__title", code: "required" }] } : {});
    }

    const resolved = await resolveForm(token);
    if (!resolved) return fail("closed");
    const result = await submitForm(resolved, parsed.data, { ip: clientIp(req.headers.get("x-forwarded-for")) });
    if (!result.ok) return fail(result.code, result.issues ? { issues: result.issues } : {});
    return Response.json({ ok: true, submissionId: result.submissionId, key: result.key, success: result.success, waitSeconds: result.waitSeconds });
  } catch (err) {
    logger.error({ err }, "form submission failed");
    return fail("unexpected");
  }
}
