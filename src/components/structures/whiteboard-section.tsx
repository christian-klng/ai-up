"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Presentation } from "lucide-react";
import type { WhiteboardItem } from "@/lib/structures/types";
import { Button } from "@/components/ui/button";

const WhiteboardEditor = dynamic(() => import("./whiteboard-editor").then((m) => m.WhiteboardEditor), { ssr: false });
const LiveWhiteboard = dynamic(() => import("./live-whiteboard").then((m) => m.LiveWhiteboard), { ssr: false });

export type WhiteboardLiveProps = {
  contentId: string;
  /** may this viewer join the live session of this element? */
  canJoin: boolean;
  authors?: Record<string, string>;
  maxUploadMb?: number;
};

/**
 * A whiteboard on the entry page: the saved board read-only, plus the way into the live session.
 * After leaving, the board shows what the session left behind – the saved version follows a
 * moment later (the session is saved in the background).
 */
export function WhiteboardSection({ label, elementKey, items, live }: { label: string; elementKey: string; items: WhiteboardItem[]; live?: WhiteboardLiveProps }) {
  const t = useTranslations("knowledge.structured.whiteboard");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lastLive, setLastLive] = useState<WhiteboardItem[] | null>(null);
  const shown = lastLive ?? items;

  const onClose = useCallback(
    (final: WhiteboardItem[] | null) => {
      setOpen(false);
      if (final) setLastLive(final);
      router.refresh();
    },
    [router],
  );

  return (
    <section>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{label}</h2>
        {live?.canJoin && (
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            <Presentation className="size-4" /> {t("join")}
          </Button>
        )}
      </div>
      {shown.length > 0 ? (
        <WhiteboardEditor key={lastLive ? "live" : "saved"} items={shown} authors={live?.authors} />
      ) : (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t("emptyBoard")}</div>
      )}
      {open && live && <LiveWhiteboard contentId={live.contentId} elementKey={elementKey} authors={live.authors} maxUploadMb={live.maxUploadMb} onClose={onClose} />}
    </section>
  );
}
