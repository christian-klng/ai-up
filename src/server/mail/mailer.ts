import nodemailer from "nodemailer";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { brandInitials, mailBrandColors, type MailBrandColors } from "@/lib/brand";

/**
 * Thin SMTP wrapper. In development, docker-compose.dev.yml provides Mailpit on :1025 (UI :8025).
 */
const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } : undefined,
});

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendMail(msg: MailMessage): Promise<void> {
  try {
    const info = await transporter.sendMail({ from: env.SMTP_FROM, ...msg });
    logger.info({ to: msg.to, subject: msg.subject, messageId: info.messageId }, "mail sent");
  } catch (err) {
    logger.error({ err, to: msg.to, subject: msg.subject }, "mail failed");
    throw err;
  }
}

/** What a mail shows of the sender: name, logo (absolute URL – mail clients load nothing relative) and colors. */
export type MailBrand = {
  appName: string;
  logoUrl?: string | null;
  colors: MailBrandColors;
};

/** A brand that says nothing but the name – for mails sent before any community is known. */
export function neutralBrand(appName: string): MailBrand {
  return { appName, logoUrl: null, colors: mailBrandColors(undefined) };
}

/**
 * Logo or monogram next to the name, so the mail is recognisable before a word is read. The
 * monogram is a colored cell rather than an image: it needs no download and survives blocked images.
 */
function mailHeader(brand: MailBrand): string {
  const mark = brand.logoUrl
    ? `<img src="${escapeAttr(brand.logoUrl)}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:8px;">`
    : `<div style="width:40px;height:40px;line-height:40px;border-radius:8px;background:${brand.colors.color};color:${brand.colors.foreground};font-size:16px;font-weight:600;text-align:center;">${escapeHtml(brandInitials(brand.appName))}</div>`;
  return `<table role="presentation" cellspacing="0" cellpadding="0"><tr>
          <td style="padding-right:12px;vertical-align:middle;">${mark}</td>
          <td style="font-size:15px;font-weight:600;color:#1f2933;vertical-align:middle;">${escapeHtml(brand.appName)}</td>
        </tr></table>`;
}

/** Minimal, dependency-free HTML layout for transactional mails. */
export function mailLayout(opts: { brand: MailBrand; title: string; bodyHtml: string; footer?: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td style="padding-bottom:24px;">${mailHeader(opts.brand)}</td></tr>
        <tr><td style="font-size:20px;font-weight:600;padding-bottom:16px;">${escapeHtml(opts.title)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.55;">${opts.bodyHtml}</td></tr>
        ${opts.footer ? `<tr><td style="font-size:12px;color:#9ca3af;padding-top:24px;">${escapeHtml(opts.footer)}</td></tr>` : ""}
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function mailButton(href: string, label: string, colors: MailBrandColors): string {
  return `<p style="margin:24px 0;"><a href="${escapeAttr(href)}" style="display:inline-block;background:${colors.color};color:${colors.foreground};text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">${escapeHtml(label)}</a></p>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
