import type { Locale } from "@/i18n/config";
import { escapeHtml, mailButton, mailLayout, type MailMessage } from "./mailer";

type Ctx = { appName: string; appUrl: string; locale: Locale };

const t = {
  de: {
    magicSubject: (app: string) => `Dein Anmeldelink für ${app}`,
    magicTitle: "Anmelden",
    magicBody: (app: string) => `Klicke auf den Button, um dich bei ${app} anzumelden. Der Link ist 15 Minuten gültig und kann nur einmal verwendet werden.`,
    magicButton: "Jetzt anmelden",
    magicFooter: "Wenn du diese Anmeldung nicht angefordert hast, kannst du diese E-Mail ignorieren.",
    approvedSubject: (app: string) => `Dein Zugang zu ${app} ist freigeschaltet`,
    approvedTitle: "Willkommen!",
    approvedBody: (app: string) => `Dein Konto bei ${app} wurde freigeschaltet. Melde dich jetzt mit dem Button an – du erhältst danach jederzeit einen neuen Anmeldelink per E-Mail.`,
    approvedButton: "Anmelden",
    pendingAdminSubject: (app: string) => `Neue Registrierung bei ${app}`,
    pendingAdminTitle: "Neue Registrierung wartet auf Freigabe",
    pendingAdminBody: (name: string, email: string) => `${name} (${email}) hat sich registriert und wartet auf die Freigabe.`,
    pendingAdminButton: "Mitglieder verwalten",
    fallback: "Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:",
  },
  en: {
    magicSubject: (app: string) => `Your sign-in link for ${app}`,
    magicTitle: "Sign in",
    magicBody: (app: string) => `Click the button to sign in to ${app}. The link is valid for 15 minutes and can be used once.`,
    magicButton: "Sign in now",
    magicFooter: "If you did not request this sign-in, you can safely ignore this e-mail.",
    approvedSubject: (app: string) => `Your access to ${app} has been approved`,
    approvedTitle: "Welcome!",
    approvedBody: (app: string) => `Your account at ${app} has been approved. Use the button to sign in – you will receive a fresh sign-in link by e-mail whenever you need one.`,
    approvedButton: "Sign in",
    pendingAdminSubject: (app: string) => `New registration at ${app}`,
    pendingAdminTitle: "New registration awaiting approval",
    pendingAdminBody: (name: string, email: string) => `${name} (${email}) registered and is waiting for approval.`,
    pendingAdminButton: "Manage members",
    fallback: "If the button does not work, copy this link into your browser:",
  },
} as const;

function linkFallback(locale: Locale, url: string) {
  return `<p style="font-size:12px;color:#6b7280;">${t[locale].fallback}<br><span style="word-break:break-all;">${escapeHtml(url)}</span></p>`;
}

export function magicLinkMail(ctx: Ctx, to: string, url: string): MailMessage {
  const s = t[ctx.locale];
  return {
    to,
    subject: s.magicSubject(ctx.appName),
    text: `${s.magicBody(ctx.appName)}\n\n${url}\n\n${s.magicFooter}`,
    html: mailLayout({
      appName: ctx.appName,
      title: s.magicTitle,
      bodyHtml: `<p>${escapeHtml(s.magicBody(ctx.appName))}</p>${mailButton(url, s.magicButton)}${linkFallback(ctx.locale, url)}`,
      footer: s.magicFooter,
    }),
  };
}

export function accountApprovedMail(ctx: Ctx, to: string, loginUrl: string): MailMessage {
  const s = t[ctx.locale];
  return {
    to,
    subject: s.approvedSubject(ctx.appName),
    text: `${s.approvedBody(ctx.appName)}\n\n${loginUrl}`,
    html: mailLayout({
      appName: ctx.appName,
      title: s.approvedTitle,
      bodyHtml: `<p>${escapeHtml(s.approvedBody(ctx.appName))}</p>${mailButton(loginUrl, s.approvedButton)}${linkFallback(ctx.locale, loginUrl)}`,
    }),
  };
}

export function pendingMemberAdminMail(ctx: Ctx, to: string, member: { name: string; email: string }): MailMessage {
  const s = t[ctx.locale];
  const url = `${ctx.appUrl}/admin/members?status=pending`;
  return {
    to,
    subject: s.pendingAdminSubject(ctx.appName),
    text: `${s.pendingAdminBody(member.name, member.email)}\n\n${url}`,
    html: mailLayout({
      appName: ctx.appName,
      title: s.pendingAdminTitle,
      bodyHtml: `<p>${escapeHtml(s.pendingAdminBody(member.name, member.email))}</p>${mailButton(url, s.pendingAdminButton)}`,
    }),
  };
}
