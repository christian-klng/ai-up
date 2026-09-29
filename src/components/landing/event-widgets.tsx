"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { EVENT_WIDGET_SCRIPT_PATH } from "@/lib/event-widgets";

/** Where the widgets load from and how they speak; resolved on the server, never from the definition. */
export type EventWidgetSource = {
  /** Origin of the event service */
  url: string;
  locale: string;
  texts: Record<string, string>;
};

export type EventWidgetTag = "event-list" | "event-detail" | "event-order-status";

declare global {
  interface Window {
    eventWidgetConfig?: { api?: string; locale?: string; texts?: Record<string, string> };
  }
}

const SCRIPT_MARK = "data-aiup-event-widgets";

/**
 * Loads the widget script once per document. The script reads its configuration when it runs, so
 * texts and locale are those of the first page that showed a widget – until the next full load.
 */
function loadScript(source: EventWidgetSource) {
  if (document.querySelector(`script[${SCRIPT_MARK}]`)) return;
  window.eventWidgetConfig = { api: source.url, locale: source.locale, texts: source.texts };
  const script = document.createElement("script");
  script.src = `${source.url}${EVENT_WIDGET_SCRIPT_PATH}`;
  script.async = true;
  script.setAttribute(SCRIPT_MARK, "");
  document.head.append(script);
}

/**
 * One widget of the event service. The element is created by hand instead of rendered: the script
 * fills it with its own markup, which React would otherwise take for a hydration mismatch and
 * throw away.
 */
export function EventWidget({
  source,
  tag,
  attributes,
  inert,
}: {
  source: EventWidgetSource;
  tag: EventWidgetTag;
  attributes?: Record<string, string | number | undefined>;
  /** Show only: the inline editor must not start a purchase when someone clicks around in it */
  inert?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  // Serialized, so a parent re-render with equal values does not reload the widget.
  const attrs = JSON.stringify(attributes ?? {});
  const texts = JSON.stringify(source.texts);
  const { url, locale } = source;

  useEffect(() => {
    const parent = container.current;
    if (!parent) return;
    loadScript({ url, locale, texts: JSON.parse(texts) as Record<string, string> });
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(JSON.parse(attrs) as Record<string, string | number>)) {
      element.setAttribute(name, String(value));
    }
    parent.replaceChildren(element);
    return () => element.remove();
  }, [tag, attrs, url, locale, texts]);

  return <div ref={container} inert={inert} />;
}

const noSubscription = () => () => {};
const hasOrder = () => new URLSearchParams(window.location.search).has("session_id");

/** Shows its content only on the way back from the payment (`?session_id=…` in the address). */
export function OrderReturnOnly({ children }: { children: ReactNode }) {
  const returned = useSyncExternalStore(noSubscription, hasOrder, () => false);
  return returned ? children : null;
}
