"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, ImagePlus, Loader2, PartyPopper, X } from "lucide-react";
import type { FormContactMode, FormResponse, FormSubmitError, FormSuccess } from "@/lib/collection-forms";
import type { ImageAnswer, LinkAnswer, StructureAnswers, StructureDefinition, StructureElement } from "@/lib/structures/types";
import { validateStructureAnswers, type AnswerIssue } from "@/lib/structures/validate";
import { visibleElements } from "@/lib/structures/visibility";
import { Markdown } from "@/components/content/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Props = {
  token: string;
  /** the public part of the template (src/lib/collection-forms.ts) */
  definition: StructureDefinition;
  titleLabel: string;
  submitLabel: string;
  contact: FormContactMode;
  /** offer "answer me by e-mail" (the form allows workflows to mail senders) */
  mailReply: boolean;
  /** signed render time; the server measures the time to fill in with it */
  stamp: string;
  privacyUrl: string | null;
  maxUploadMb: number;
};

type Upload = { ticket: string; preview: string; name: string };
type Issue = { key: string; code: AnswerIssue["code"]; count?: number };

const TITLE_KEY = "__title";
const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30";

/**
 * The form people outside the community fill in (docs/externe-formulare.md). A lean renderer of
 * its own rather than the members' fill form: no boards, no server actions, no session – it talks
 * to /api/forms and /api/upload only, so it also works inside an iframe on somebody else's site.
 */
export function PublicForm({ token, definition, titleLabel, submitLabel, contact, mailReply, stamp, privacyUrl, maxUploadMb }: Props) {
  const t = useTranslations("forms");
  const [title, setTitle] = useState("");
  const [answers, setAnswers] = useState<StructureAnswers>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mailConsent, setMailConsent] = useState(false);
  const [website, setWebsite] = useState("");
  /** a workflow is writing the answer: the submission to ask about, and the message to fall back to */
  const [waiting, setWaiting] = useState<{ id: string; key: string; seconds: number; fallback: FormSuccess } | null>(null);
  const [uploads, setUploads] = useState<Record<string, Upload>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<FormSuccess | null>(null);

  // Ask for the workflow's answer until it is there or the form's patience runs out; then the
  // static message is as good as it gets.
  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    const finish = (success: FormSuccess) => {
      if (stopped) return;
      stopped = true;
      setWaiting(null);
      setDone(success);
    };
    const deadline = window.setTimeout(() => finish(waiting.fallback), waiting.seconds * 1000);
    const poll = async () => {
      try {
        const res = await fetch(`/api/forms/${encodeURIComponent(token)}/submissions/${waiting.id}?key=${encodeURIComponent(waiting.key)}`, { cache: "no-store" });
        const body = res.ok ? ((await res.json()) as { status: "pending" } | { status: "ready"; response: FormResponse }) : null;
        if (body?.status === "ready") {
          const r = body.response;
          finish({ ...waiting.fallback, style: r.style ?? waiting.fallback.style, title: r.title || waiting.fallback.title, body: r.body });
        }
      } catch {
        // a failed poll is just a later answer
      }
    };
    const timer = window.setInterval(() => void poll(), 1500);
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(deadline);
      window.clearInterval(timer);
    };
  }, [waiting, token]);

  const visible = useMemo(() => visibleElements(definition, answers), [definition, answers]);
  const issueFor = (key: string) => issues.find((i) => i.key === key);

  const setValue = (key: string, value: StructureAnswers[string] | undefined) => {
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
    setIssues((prev) => prev.filter((i) => i.key !== key));
  };

  const upload = async (key: string, file: File) => {
    setError(null);
    if (file.size > maxUploadMb * 1024 * 1024) {
      setError(t("errors.imageTooLarge", { mb: maxUploadMb }));
      return;
    }
    setUploading(key);
    try {
      const res = await fetch(`/api/upload?form=${encodeURIComponent(token)}&name=${encodeURIComponent(file.name)}`, { method: "PUT", body: file });
      if (!res.ok) {
        setError(res.status === 415 ? t("errors.imageType") : res.status === 413 ? t("errors.imageTooLarge", { mb: maxUploadMb }) : res.status === 429 ? t("errors.rateLimited") : t("errors.unexpected"));
        return;
      }
      const media = (await res.json()) as { id: string; ticket: string };
      setUploads((prev) => ({ ...prev, [media.id]: { ticket: media.ticket, preview: URL.createObjectURL(file), name: file.name } }));
      setValue(key, { mediaId: media.id } satisfies ImageAnswer);
    } catch {
      setError(t("errors.unexpected"));
    } finally {
      setUploading(null);
    }
  };

  const submit = async () => {
    setError(null);
    const found: Issue[] = [];
    if (!title.trim()) found.push({ key: TITLE_KEY, code: "required" });
    const res = validateStructureAnswers(definition, answers);
    if (!res.ok) found.push(...res.issues);
    const contactMissing = contact === "required" && (!name.trim() || !email.trim());
    if (found.length || contactMissing) {
      setIssues(found);
      setError(t("errors.missing"));
      return;
    }
    const clean = res.ok ? res.answers : {};
    const tickets: Record<string, string> = {};
    for (const value of Object.values(clean)) {
      const id = typeof value === "object" && value !== null && !Array.isArray(value) && "mediaId" in value ? (value as ImageAnswer).mediaId : undefined;
      if (id && uploads[id]) tickets[id] = uploads[id].ticket;
    }
    setSending(true);
    try {
      const response = await fetch(`/api/forms/${encodeURIComponent(token)}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          answers: clean,
          contact: contact === "off" ? undefined : { name: name.trim() || undefined, email: email.trim() || undefined },
          mailConsent: mailReply && mailConsent && Boolean(email.trim()),
          stamp,
          website: website || undefined,
          // Inside an embed the page that matters is the one around the iframe.
          pageUrl: (window.self !== window.top ? document.referrer : window.location.href) || undefined,
          uploads: tickets,
        }),
      });
      const body = (await response.json().catch(() => null)) as { ok: true; success: FormSuccess; submissionId: string | null; key: string | null; waitSeconds: number | null } | { ok: false; code: FormSubmitError; issues?: Issue[] } | null;
      if (body?.ok) {
        if (body.waitSeconds && body.submissionId && body.key) setWaiting({ id: body.submissionId, key: body.key, seconds: body.waitSeconds, fallback: body.success });
        else setDone(body.success);
        return;
      }
      if (body?.issues?.length) setIssues(body.issues);
      const code = body?.code ?? "unexpected";
      setError(code === "invalid" ? t("errors.missing") : t(`errors.${code}`));
    } catch {
      setError(t("errors.unexpected"));
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setTitle("");
    setAnswers({});
    setUploads({});
    setIssues([]);
    setError(null);
    setMailConsent(false);
    setDone(null);
  };

  if (waiting) {
    return (
      <div role="status" className="flex items-center gap-3 rounded-lg border p-4 text-sm text-muted-foreground">
        <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden />
        {t("waiting")}
      </div>
    );
  }
  if (done) return <SuccessMessage success={done} onAnother={done.allowAnother ? reset : undefined} />;

  const issueText = (issue: Issue | undefined) => (issue ? <p className="text-xs text-destructive">{t(`issues.${issue.code}`, { count: issue.count ?? 0 })}</p> : null);

  return (
    <form
      className="grid grid-cols-1 gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label={titleLabel || t("titleLabel")} required htmlFor="form-title">
        <Input id="form-title" value={title} maxLength={200} aria-invalid={Boolean(issueFor(TITLE_KEY))} onChange={(e) => { setTitle(e.target.value); setIssues((prev) => prev.filter((i) => i.key !== TITLE_KEY)); }} />
        {issueText(issueFor(TITLE_KEY))}
      </Field>

      {visible.map((el) => {
        if (el.type === "info") {
          return (
            <div key={el.key} className="rounded-lg bg-muted/50 p-3 text-sm">
              {el.label && <p className="font-medium">{el.label}</p>}
              <Markdown className="text-muted-foreground">{el.body}</Markdown>
            </div>
          );
        }
        const issue = issueFor(el.key);
        const id = `form-${el.key}`;
        if (el.type === "checkbox") {
          return (
            <div key={el.key} className="grid gap-1.5">
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={answers[el.key] === true} onChange={(e) => setValue(el.key, e.target.checked ? true : undefined)} />
                <span>
                  {el.label}
                  {el.required && <span className="text-destructive"> *</span>}
                </span>
              </label>
              {el.help && <p className="text-xs text-muted-foreground">{el.help}</p>}
              {issueText(issue)}
            </div>
          );
        }
        return (
          <Field key={el.key} label={el.label} required={el.required} help={el.help} htmlFor={id}>
            <FieldInput el={el} id={id} invalid={Boolean(issue)} value={answers[el.key]} onChange={(v) => setValue(el.key, v)} upload={uploads} uploading={uploading === el.key} onUpload={(file) => void upload(el.key, file)} t={t} />
            {issueText(issue)}
          </Field>
        );
      })}

      {contact !== "off" && (
        <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
          <Field label={t("contactName")} required={contact === "required"} htmlFor="form-contact-name">
            <Input id="form-contact-name" autoComplete="name" maxLength={120} value={name} aria-invalid={contact === "required" && Boolean(error) && !name.trim()} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("contactEmail")} required={contact === "required"} htmlFor="form-contact-email">
            <Input id="form-contact-email" type="email" autoComplete="email" maxLength={200} value={email} aria-invalid={contact === "required" && Boolean(error) && !email.trim()} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {mailReply && (
            <label className="flex items-start gap-2.5 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={mailConsent} onChange={(e) => setMailConsent(e.target.checked)} />
              <span>{t("mailConsent")}</span>
            </label>
          )}
        </div>
      )}

      {/* Honeypot: off-screen, out of the tab order, hidden from screen readers – people never fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" disabled={sending || uploading !== null}>
          {sending && <Loader2 className="size-4 animate-spin" />}
          {submitLabel || t("submit")}
        </Button>
        {privacyUrl && (
          <p className="text-xs text-muted-foreground">
            {t("privacyHint")}{" "}
            <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {t("privacyLink")}
            </a>
          </p>
        )}
      </div>
    </form>
  );
}

function Field({ label, required, help, htmlFor, children }: { label: string; required?: boolean; help?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      {children}
    </div>
  );
}

function FieldInput({
  el,
  id,
  invalid,
  value,
  onChange,
  upload,
  uploading,
  onUpload,
  t,
}: {
  el: StructureElement;
  id: string;
  invalid: boolean;
  value: StructureAnswers[string] | undefined;
  onChange: (value: StructureAnswers[string] | undefined) => void;
  upload: Record<string, Upload>;
  uploading: boolean;
  onUpload: (file: File) => void;
  t: ReturnType<typeof useTranslations<"forms">>;
}) {
  switch (el.type) {
    case "text":
      return <Input id={id} aria-invalid={invalid} placeholder={el.placeholder} maxLength={el.maxLength ?? 2000} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} />;
    case "textarea":
    case "markdown":
      return <Textarea id={id} aria-invalid={invalid} rows={5} placeholder={el.placeholder} maxLength={el.maxLength ?? 20000} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} />;
    case "select":
      return (
        <select id={id} aria-invalid={invalid} className={selectClass} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">{el.placeholder ?? t("choose")}</option>
          {el.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "chips": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div id={id} role="group" className="flex flex-wrap gap-1.5">
          {el.options.map((o) => {
            const on = selected.includes(o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? selected.filter((x) => x !== o) : [...selected, o];
                  onChange(next.length ? next : undefined);
                }}
                className={cn("rounded-full border px-3 py-1 text-sm transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
              >
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case "link":
      return (
        <Input
          id={id}
          type="url"
          inputMode="url"
          aria-invalid={invalid}
          placeholder="https://"
          value={(value as LinkAnswer | undefined)?.url ?? ""}
          onChange={(e) => onChange(e.target.value ? ({ url: e.target.value } satisfies LinkAnswer) : undefined)}
        />
      );
    case "image": {
      const mediaId = (value as ImageAnswer | undefined)?.mediaId;
      const file = mediaId ? upload[mediaId] : undefined;
      if (file) {
        return (
          <div className="flex items-center gap-3 rounded-lg border p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the file just picked */}
            <img src={file.preview} alt="" className="size-14 rounded-md object-cover" />
            <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
            <Button type="button" variant="ghost" size="icon" aria-label={t("removeImage")} onClick={() => onChange(undefined)}>
              <X className="size-4" />
            </Button>
          </div>
        );
      }
      return (
        <label className={cn("flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground transition-colors hover:bg-accent/50", invalid && "border-destructive")}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          {uploading ? t("uploading") : t("chooseImage")}
          <input
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = "";
              if (picked) onUpload(picked);
            }}
          />
        </label>
      );
    }
    default:
      return null;
  }
}

/** What the sender sees afterwards; the three designs differ in weight, not in content. */
function SuccessMessage({ success, onAnother }: { success: FormSuccess; onAnother?: () => void }) {
  const t = useTranslations("forms");
  const title = success.title || t("success.title");
  const body = success.body || t("success.body");
  const redirect = success.redirectUrl;

  useEffect(() => {
    if (!redirect) return;
    const timer = window.setTimeout(() => window.location.assign(redirect), 2500);
    return () => window.clearTimeout(timer);
  }, [redirect]);

  const another = onAnother && !redirect && (
    <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onAnother}>
      {t("success.another")}
    </Button>
  );

  if (success.style === "plain") {
    return (
      <div role="status">
        <p className="font-medium">{title}</p>
        <Markdown className="mt-1 text-sm text-muted-foreground">{body}</Markdown>
        {another}
      </div>
    );
  }
  if (success.style === "celebrate") {
    return (
      <div role="status" className="flex flex-col items-center rounded-xl bg-primary px-6 py-10 text-center text-primary-foreground">
        <PartyPopper className="size-10" aria-hidden />
        <p className="mt-4 text-2xl font-semibold tracking-tight">{title}</p>
        <Markdown className="mt-2 text-sm opacity-90 text-inherit! [&_*]:text-inherit!">{body}</Markdown>
        {onAnother && !redirect && (
          <Button type="button" variant="secondary" size="sm" className="mt-5" onClick={onAnother}>
            {t("success.another")}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div role="status" className="flex gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <Markdown className="mt-1 text-sm text-muted-foreground">{body}</Markdown>
        {another}
      </div>
    </div>
  );
}
