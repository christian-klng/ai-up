import { z } from "zod";
import type { StructureDefinition, StructureElement } from "./structures/types";
import { isAnswerable } from "./structures/types";

/**
 * External channel of a collection (docs/externe-formulare.md): one template of the collection,
 * published as a form that people outside the community can fill in. Pure – shared by the public
 * page, the admin dialog, the domain layer and the tests.
 */

/** Element types an outsider may fill in. Boards, graphs and videos stay inside the community. */
export const FORM_FIELD_TYPES: ReadonlySet<StructureElement["type"]> = new Set(["info", "text", "textarea", "select", "chips", "checkbox", "link", "markdown", "image"]);

export function isFormFieldAllowed(el: StructureElement): boolean {
  if (!FORM_FIELD_TYPES.has(el.type)) return false;
  // An accordion list is an editor of its own; the form offers the plain text field only.
  return !(el.type === "markdown" && el.multiple);
}

export const FORM_CONTACT_MODES = ["off", "optional", "required"] as const;
export type FormContactMode = (typeof FORM_CONTACT_MODES)[number];

export const FORM_SUCCESS_STYLES = ["plain", "card", "celebrate"] as const;
export type FormSuccessStyle = (typeof FORM_SUCCESS_STYLES)[number];

/** What the sender sees after a submission. Empty title/body fall back to the translated default. */
export type FormSuccess = {
  style: FormSuccessStyle;
  title: string;
  /** Markdown */
  body: string;
  /** Offer "send another one" */
  allowAnother: boolean;
  /** https only; the form leaves for it a moment after the message appeared */
  redirectUrl: string | null;
  /** Hold the message back until a workflow answered the submission (respond_to_submission) … */
  waitForWorkflow: boolean;
  /** … but no longer than this; then the static message above is shown. */
  waitSeconds: number;
};

export const FORM_WAIT_SECONDS_DEFAULT = 20;
export const FORM_WAIT_SECONDS_MAX = 60;
export const DEFAULT_FORM_SUCCESS: FormSuccess = { style: "card", title: "", body: "", allowAnother: true, redirectUrl: null, waitForWorkflow: false, waitSeconds: FORM_WAIT_SECONDS_DEFAULT };

/** The answer a workflow wrote for one sender; replaces title and text of the static message. */
export type FormResponse = { style: FormSuccessStyle | null; title: string; body: string };
export const FORM_RESPONSE_TITLE_MAX = 120;
export const FORM_RESPONSE_BODY_MAX = 4000;

/** Mails a workflow may send to one address per day, across all forms. */
export const FORM_MAILS_PER_ADDRESS_PER_DAY = 3;

/** Texts around the fields. Empty = translated default (or, for the heading, the collection name). */
export type FormTexts = { title: string; intro: string; submitLabel: string; titleLabel: string };
export const DEFAULT_FORM_TEXTS: FormTexts = { title: "", intro: "", submitLabel: "", titleLabel: "" };

export const FORM_DAILY_LIMIT_DEFAULT = 200;
export const FORM_DAILY_LIMIT_MAX = 5000;
/** A submission's JSON body; uploads travel separately. */
export const FORM_MAX_BODY_BYTES = 64 * 1024;
export const FORM_UPLOAD_MAX_MB = 5;
export const FORM_MAX_IMAGES = 3;
/** Faster than this between rendering the form and sending it is not a person. */
export const FORM_MIN_FILL_MS = 3000;
/** A form left open longer than this must be reloaded. */
export const FORM_STAMP_TTL_MS = 24 * 60 * 60 * 1000;

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  });

export const formSettingsSchema = z.object({
  enabled: z.boolean(),
  templateId: z.string().uuid().nullable(),
  fieldKeys: z.array(z.string().max(40)).max(100),
  texts: z.object({
    title: z.string().trim().max(120),
    intro: z.string().trim().max(2000),
    submitLabel: z.string().trim().max(40),
    titleLabel: z.string().trim().max(80),
  }),
  contact: z.enum(FORM_CONTACT_MODES),
  success: z.object({
    style: z.enum(FORM_SUCCESS_STYLES),
    title: z.string().trim().max(120),
    body: z.string().trim().max(2000),
    allowAnother: z.boolean(),
    redirectUrl: httpsUrl.nullable(),
    waitForWorkflow: z.boolean(),
    waitSeconds: z.number().int().min(5).max(FORM_WAIT_SECONDS_MAX),
  }),
  /** Workflows may answer senders by e-mail (action reply_to_submitter); needs the contact fields. */
  mailReply: z.boolean(),
  dailyLimit: z.number().int().min(1).max(FORM_DAILY_LIMIT_MAX),
});
export type FormSettings = z.infer<typeof formSettingsSchema>;

/**
 * The part of a template the form shows: the chosen fields of an allowed type, in template order.
 * Submissions are validated against this, not against the whole template – a field the community
 * keeps to itself ("category", "status") may be required for members without blocking outsiders.
 * A shown field whose `showIf` points at a hidden one never appears (hidden counts as unanswered).
 */
export function publicDefinition(def: StructureDefinition, fieldKeys: readonly string[]): StructureDefinition {
  const chosen = new Set(fieldKeys);
  return { formatVersion: def.formatVersion, elements: def.elements.filter((el) => chosen.has(el.key) && isFormFieldAllowed(el)) };
}

export type FormProblem = "noTemplate" | "noFields";

/** What keeps a form from being switched on. */
export function formProblems(def: StructureDefinition | null, fieldKeys: readonly string[]): FormProblem[] {
  if (!def) return ["noTemplate"];
  return publicDefinition(def, fieldKeys).elements.some(isAnswerable) ? [] : ["noFields"];
}

/** Image fields of the form – the only place an outsider's upload may end up. */
export function formImageKeys(def: StructureDefinition): string[] {
  return def.elements.filter((el) => el.type === "image").map((el) => el.key);
}

export const formSubmissionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  answers: z.record(z.string(), z.unknown()),
  contact: z.object({ name: z.string().trim().max(120).optional(), email: z.string().trim().toLowerCase().max(200).optional() }).optional(),
  /** the sender ticked "answer me by e-mail" */
  mailConsent: z.boolean().optional(),
  /** signed render time, see issueFormStamp */
  stamp: z.string().max(200),
  /** honeypot – people never see this field */
  website: z.string().max(500).optional(),
  /** address of the page the form sits on (embeds) */
  pageUrl: z.string().max(500).optional(),
  /** mediaId → upload ticket, for every uploaded image among the answers */
  uploads: z.record(z.string().uuid(), z.string().max(200)).optional(),
});
export type FormSubmissionInput = z.infer<typeof formSubmissionSchema>;

export type FormSubmitError = "invalid" | "closed" | "tooFast" | "expired" | "rateLimited" | "contact" | "unexpected";

/** Everything the form component needs, resolved on the server (public page and `form` sections of site pages). */
export type SectionForm = {
  token: string;
  /** the form's own heading, or the collection name */
  heading: string;
  intro: string;
  definition: StructureDefinition;
  titleLabel: string;
  submitLabel: string;
  contact: FormContactMode;
  mailReply: boolean;
  stamp: string;
  privacyUrl: string | null;
  maxUploadMb: number;
};
