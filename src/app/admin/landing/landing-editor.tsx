"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { AppSettings } from "@/server/db/schema";
import type { LandingDefinition } from "@/lib/landing-schema";
import { saveLandingInlineAction } from "@/server/actions/admin-landing";
import { LandingShell } from "@/components/landing/landing-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/** Immutable helpers for dot paths like "sections.0.items.2.title" into the definition JSON. */
function getAtPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key as keyof object], obj);
}
function setAtPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const root = Array.isArray(obj) ? [...(obj as unknown[])] : { ...(obj as Record<string, unknown>) };
  let node: Record<string, unknown> | unknown[] = root as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const child = (node as Record<string, unknown>)[key];
    const copy: unknown = Array.isArray(child) ? [...child] : { ...(child as Record<string, unknown>) };
    (node as Record<string, unknown>)[key] = copy;
    node = copy as Record<string, unknown>;
  }
  (node as Record<string, unknown>)[keys[keys.length - 1]] = value;
  return root as T;
}

const EDIT_CSS = `
.landing-edit [data-ep]:hover, .landing-edit [data-ep-md]:hover { outline: 1.5px dashed var(--primary); outline-offset: 3px; cursor: text; border-radius: 2px; }
.landing-edit [data-ep][contenteditable] { outline: 1.5px solid var(--primary); outline-offset: 3px; cursor: text; border-radius: 2px; }
.landing-edit { user-select: text; }
`;

/** Mounted per editing session (parent renders it only while open) – state starts fresh on mount. */
export function LandingEditor({
  onOpenChange,
  definition,
  settings,
}: {
  onOpenChange: (open: boolean) => void;
  definition: LandingDefinition;
  settings: AppSettings;
}) {
  const t = useTranslations("admin.landing");
  const tl = useTranslations("landing");
  const tc = useTranslations("common");
  const router = useRouter();
  const [draft, setDraft] = useState<LandingDefinition>(() => structuredClone(definition));
  const [dirty, setDirty] = useState(false);
  const [mdPath, setMdPath] = useState<string | null>(null);
  const [mdText, setMdText] = useState("");
  const [saving, startSave] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep all FAQ items expanded so their answers are clickable (toggling is blocked below)
  useEffect(() => {
    containerRef.current?.querySelectorAll("details").forEach((d) => {
      d.open = true;
    });
  });

  const commit = useCallback(
    (path: string, el: HTMLElement, original: string) => {
      el.removeAttribute("contenteditable");
      const text = (el.innerText ?? "").trim();
      if (text === original.trim()) {
        el.innerText = original;
        return;
      }
      if (!text) {
        el.innerText = original;
        toast.info(t("emptyIgnored"));
        return;
      }
      setDraft((d) => setAtPath(d, path, text));
      setDirty(true);
    },
    [t],
  );

  const beginEdit = useCallback(
    (el: HTMLElement, path: string) => {
      const original = String(getAtPath(draft, path) ?? el.innerText);
      try {
        el.contentEditable = "plaintext-only";
      } catch {
        el.contentEditable = "true";
      }
      el.focus();
      window.getSelection()?.selectAllChildren(el);
      let done = false;
      const finish = (cancel: boolean) => {
        if (done) return;
        done = true;
        el.removeEventListener("keydown", onKeyDown);
        el.removeEventListener("blur", onBlur);
        if (cancel) {
          el.removeAttribute("contenteditable");
          el.innerText = original;
        } else {
          commit(path, el, original);
        }
        el.blur();
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(false);
        } else if (e.key === "Escape") {
          e.stopPropagation(); // keep the dialog open
          finish(true);
        }
      };
      const onBlur = () => finish(false);
      el.addEventListener("keydown", onKeyDown);
      el.addEventListener("blur", onBlur);
    },
    [draft, commit],
  );

  // Capture phase: next/link navigates from its own onClick at the target, so we must intercept
  // before any target handler runs (preventDefault alone in the bubble phase is too late).
  const onContainerClickCapture = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const md = target.closest<HTMLElement>("[data-ep-md]");
      const ep = target.closest<HTMLElement>("[data-ep]");
      const blocked = md ?? ep ?? target.closest("a") ?? target.closest("summary");
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (md) {
        const path = md.getAttribute("data-ep-md")!;
        setMdPath(path);
        setMdText(String(getAtPath(draft, path) ?? ""));
        return;
      }
      if (ep && !ep.isContentEditable) beginEdit(ep, ep.getAttribute("data-ep")!);
    },
    [draft, beginEdit],
  );

  const applyMarkdown = () => {
    if (!mdPath) return;
    const text = mdText.trim();
    if (!text) {
      toast.info(t("emptyIgnored"));
    } else if (text !== String(getAtPath(draft, mdPath) ?? "").trim()) {
      setDraft((d) => setAtPath(d, mdPath, text));
      setDirty(true);
    }
    setMdPath(null);
  };

  const requestClose = (next: boolean) => {
    if (!next && dirty && !confirm(t("confirmDiscard"))) return;
    onOpenChange(next);
  };

  const save = () => {
    startSave(async () => {
      const res = await saveLandingInlineAction(draft);
      if (res.ok) {
        toast.success(tc("saved"));
        onOpenChange(false);
        router.refresh();
      } else {
        const issue = res.issues?.[0];
        toast.error(issue ? `${issue.path}: ${issue.message}` : tc("unexpectedError"));
      }
    });
  };

  return (
    <Dialog open onOpenChange={requestClose}>
      <DialogContent
        className="h-[92svh] w-[96vw] gap-0 p-0 sm:max-w-[1280px] grid grid-rows-[auto_1fr_auto] overflow-hidden"
        showCloseButton
        onInteractOutside={(e) => e.preventDefault()}
      >
        <style dangerouslySetInnerHTML={{ __html: EDIT_CSS }} />
        <DialogHeader className="border-b px-4 py-3 pr-12">
          <DialogTitle>{t("editorTitle")}</DialogTitle>
          <DialogDescription>{t("editHint")}</DialogDescription>
        </DialogHeader>
        <div className="relative min-h-0">
          {mdPath && (
            <div className="absolute inset-x-4 top-3 z-50 grid gap-2 rounded-lg border bg-popover p-3 shadow-lg sm:inset-x-10">
              <p className="text-sm font-medium">{t("editMarkdownTitle")}</p>
              <Textarea value={mdText} onChange={(e) => setMdText(e.target.value)} rows={12} className="font-mono text-xs" autoFocus />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setMdPath(null)}>
                  {t("mdCancel")}
                </Button>
                <Button size="sm" onClick={applyMarkdown}>
                  {t("mdApply")}
                </Button>
              </div>
            </div>
          )}
          <div ref={containerRef} className="landing-edit h-full overflow-y-auto" onClickCapture={onContainerClickCapture}>
            <LandingShell
              definition={draft}
              settings={settings}
              signedIn
              labels={{ toApp: tl("toApp"), signIn: tl("signIn"), register: tl("register"), menu: tc("menu") }}
            />
          </div>
        </div>
        <DialogFooter className="m-0 rounded-none border-t px-4 py-3">
          <Button variant="outline" onClick={() => requestClose(false)} disabled={saving}>
            {t("discard")}
          </Button>
          <Button onClick={save} disabled={!dirty || saving}>
            {t("saveAndClose")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
