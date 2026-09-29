/**
 * Event widgets on the public pages: the operator's event service (seminars, workshops, ticket
 * sales) ships a script that defines `<event-list>`, `<event-detail>` and `<event-order-status>`.
 * Pure helpers, shared by the admin action, the domain layer and the renderer.
 */

/** Path of the widget script below the origin of the event service. */
export const EVENT_WIDGET_SCRIPT_PATH = "/embed.js";

/**
 * Reduces what an admin typed to the origin of the event service. https only – the script runs
 * with the rights of the page – except for a service on the developer's own machine.
 */
export function normalizeEventServiceUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.origin;
}

/** BCP 47 tag for dates and prices in the widgets, from the language of the community. */
export function eventWidgetLocale(locale: string): string {
  return locale === "en" ? "en-GB" : "de-DE";
}
