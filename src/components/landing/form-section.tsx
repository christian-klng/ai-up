"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import type { SectionForm } from "@/lib/collection-forms";
import type { FormSection } from "@/lib/landing-schema";
import { Markdown } from "@/components/content/markdown";
import { PublicForm } from "@/components/forms/public-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type FormLabels = { formUnavailable: string; formOpen: string };

/**
 * Public form of a collection inside a site page (docs/externe-formulare.md 3) – rendered natively,
 * not through the embed script's iframe: the page is ours. Three ways to show it: in the page, behind
 * a button, or behind a button fixed to the corner. The form itself is resolved on the server; a
 * collection without an open form leaves the section invisible.
 */
export function FormSectionView({ section, path, form, labels, editing }: { section: FormSection; path: string; form: SectionForm | undefined; labels: FormLabels; editing?: boolean }) {
  const [open, setOpen] = useState(false);

  if (!form) {
    return editing ? (
      <section className="py-10">
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{labels.formUnavailable}</p>
      </section>
    ) : null;
  }

  const title = section.title ?? form.heading;
  const intro = section.intro ?? form.intro;
  const buttonLabel = section.buttonLabel ?? section.title ?? labels.formOpen;

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {/* Always present for screen readers; the visible introduction may be Markdown. */}
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        {intro && <Markdown className="text-sm text-muted-foreground">{intro}</Markdown>}
        <PublicForm form={form} />
      </DialogContent>
    </Dialog>
  );

  if (section.display === "floating") {
    // The inline editor shows it in place: a fixed button would sit on top of the editor's own controls.
    if (editing) {
      return (
        <section className="flex justify-end py-6">
          <Button className="rounded-full shadow-lg" inert>
            <Send className="size-4" /> <span data-ep={`${path}.buttonLabel`}>{buttonLabel}</span>
          </Button>
        </section>
      );
    }
    return (
      <>
        <Button className="fixed right-5 bottom-5 z-30 rounded-full shadow-lg" size="lg" onClick={() => setOpen(true)}>
          <Send className="size-4" /> {buttonLabel}
        </Button>
        {dialog}
      </>
    );
  }

  const heading = (
    <>
      <h2 className="text-center text-2xl font-semibold tracking-tight text-balance" data-ep={section.title ? `${path}.title` : undefined}>
        {title}
      </h2>
      {intro &&
        (section.intro ? (
          <p className="mx-auto mt-2 max-w-2xl text-center text-muted-foreground" data-ep={`${path}.intro`}>
            {intro}
          </p>
        ) : (
          <Markdown className="mx-auto mt-2 max-w-2xl text-center text-muted-foreground">{intro}</Markdown>
        ))}
    </>
  );

  if (section.display === "button") {
    return (
      <section className="py-10 text-center">
        {heading}
        <Button className="mt-6" size="lg" onClick={() => setOpen(true)} inert={editing}>
          <span data-ep={section.buttonLabel ? `${path}.buttonLabel` : undefined}>{buttonLabel}</span>
        </Button>
        {dialog}
      </section>
    );
  }

  return (
    <section className="py-10">
      {heading}
      {/* Show only in the editor: nobody should send a real entry while clicking around in it. */}
      <div className="mx-auto mt-8 max-w-xl rounded-xl border bg-card p-5 shadow-sm sm:p-7" inert={editing}>
        <PublicForm form={form} />
      </div>
    </section>
  );
}
