"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `handler` exactly once per new action state object (useActionState returns a new object per submit).
 * Avoids duplicate toasts when unrelated dependencies (translations, router) change identity after a refresh.
 */
export function useActionFeedback<S extends { status: string }>(state: S, handler: (state: S) => void) {
  const handled = useRef<S | null>(null);
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (state.status === "idle" || handled.current === state) return;
    handled.current = state;
    handlerRef.current(state);
  }, [state]);
}
