"use client";

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/**
 * Full-width, uncropped image that opens an enlarged modal view on click
 * (entry images on the content detail page). Labels come in as props so the
 * server page owns i18n.
 */
export function ImageLightbox({ src, alt, enlargeLabel }: { src: string; alt: string; enlargeLabel: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" aria-label={enlargeLabel} className="block w-full cursor-zoom-in rounded-md border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="h-auto max-h-[70vh] w-full rounded-md object-contain" />
        </button>
      </DialogTrigger>
      <DialogContent className="w-fit max-w-[95vw] bg-transparent p-0 ring-0 sm:max-w-[95vw]">
        <DialogTitle className="sr-only">{alt || enlargeLabel}</DialogTitle>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="max-h-[90vh] w-auto max-w-full rounded-md object-contain" />
      </DialogContent>
    </Dialog>
  );
}
