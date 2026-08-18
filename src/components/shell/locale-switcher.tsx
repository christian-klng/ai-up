"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Languages } from "lucide-react";
import { setLocale } from "@/server/actions/locale";
import { locales, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

const LABELS: Record<Locale, string> = { de: "DE", en: "EN" };

export function LocaleSwitcher({ label, className }: { label: string; className?: string }) {
  const current = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className={cn("inline-flex items-center gap-1 text-sm", className)} role="group" aria-label={label}>
      <Languages className="size-4 text-muted-foreground" aria-hidden />
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          aria-pressed={current === l}
          onClick={() =>
            start(async () => {
              await setLocale(l);
              router.refresh();
            })
          }
          className={cn(
            "rounded px-1.5 py-0.5 font-medium transition-colors",
            current === l ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  );
}
