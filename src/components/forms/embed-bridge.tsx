"use client";

import { useEffect } from "react";

/** Messages the embedded form sends to the page around its iframe (read by /api/forms/embed.js). */
export type FormEmbedMessage = { type: "aiup-form:height"; height: number } | { type: "aiup-form:submitted" } | { type: "aiup-form:redirect"; url: string };

/** True inside an iframe. */
export function isEmbedded(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

/**
 * Tells the embedding page something. The target is `*` on purpose: the form may be embedded
 * anywhere, and none of these messages carries anything the sender typed.
 */
export function postToEmbedder(message: FormEmbedMessage) {
  if (isEmbedded()) window.parent.postMessage(message, "*");
}

/** Keeps the iframe as tall as its content, so the host page never shows a second scrollbar. */
export function EmbedBridge() {
  useEffect(() => {
    if (!isEmbedded()) return;
    // The content, not the document: <body> stretches to the frame and would never report less.
    const content = document.querySelector("main") ?? document.body;
    const report = () => postToEmbedder({ type: "aiup-form:height", height: content.getBoundingClientRect().height });
    const observer = new ResizeObserver(report);
    observer.observe(content);
    report();
    return () => observer.disconnect();
  }, []);
  return null;
}
