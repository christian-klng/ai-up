"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import Link from "next/link";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { switchCommunityAction } from "@/server/actions/communities";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type SwitcherCommunity = { id: string; name: string; tagline: string | null; logoMediaId: string | null; role: "member" | "admin" };

/** Square initial for a community without a logo – same look as the sidebar brand. */
function CommunityMark({ community, size = 28 }: { community: SwitcherCommunity; size?: number }) {
  if (community.logoMediaId) {
    // eslint-disable-next-line @next/next/no-img-element -- media is served by our own route, no loader needed
    return <img src={`/api/files/${community.logoMediaId}?v=thumb`} alt="" width={size} height={size} className="shrink-0 rounded object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded bg-primary/15 font-semibold text-primary"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden
    >
      {community.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * The community name in the sidebar, as a switcher when the account belongs to more than one.
 * With a single membership it stays a plain label – nothing to choose, nothing to explain.
 */
export function CommunitySwitcher({ current, communities, canCreate, logo }: { current: SwitcherCommunity; communities: SwitcherCommunity[]; canCreate: boolean; logo: React.ReactNode }) {
  const t = useTranslations("communities");
  const tRole = useTranslations("role");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  // With one membership and nothing to create there is no choice to offer – stay a plain label.
  if (communities.length < 2 && !canCreate) {
    return (
      <div className="flex items-center gap-2.5 px-4 py-4">
        {logo}
        <span className="truncate font-semibold tracking-tight">{current.name}</span>
      </div>
    );
  }

  const pick = (id: string) => {
    if (id === current.id) {
      setOpen(false);
      return;
    }
    start(async () => {
      const res = await switchCommunityAction(id);
      if (!res.ok) {
        toast.error(tc("unexpectedError"));
        return;
      }
      setOpen(false);
      // Another host, or a route handler that redirects: both need a real page load, not a
      // client-side route change (see switchCommunityAction).
      if (res.leaveApp) window.location.assign(res.href);
      else router.push(res.href);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2.5 px-4 py-4 text-left hover:bg-sidebar-accent/50" aria-label={t("switch")}>
          {logo}
          <span className="truncate font-semibold tracking-tight">{current.name}</span>
          <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-60" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("switch")}</DialogTitle>
          <DialogDescription>{t("switchIntro")}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1">
          {communities.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => pick(c.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border p-3 text-left disabled:opacity-60",
                  c.id === current.id ? "border-primary/40 bg-accent/60" : "hover:bg-accent/40",
                )}
                aria-current={c.id === current.id ? "true" : undefined}
              >
                <CommunityMark community={c} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    {c.role === "admin" && <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{tRole("admin")}</span>}
                  </span>
                  {c.tagline && <span className="block truncate text-sm text-muted-foreground">{c.tagline}</span>}
                </span>
                {c.id === current.id && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
        {canCreate && (
          <Link href="/communities/new" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm font-medium hover:bg-accent/40">
            <Plus className="size-4" aria-hidden /> {t("createNew")}
          </Link>
        )}
      </DialogContent>
    </Dialog>
  );
}
