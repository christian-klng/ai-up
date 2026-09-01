"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { AREA_ICON_KEYS, AreaIcon } from "@/components/knowledge/area-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Searchable dropdown for the ~100 collection/meeting-space icons (flat grids got too big). */
export function IconPicker({ value, onChange, id }: { value: string; onChange: (icon: string) => void; id?: string }) {
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const keys = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? AREA_ICON_KEYS.filter((k) => k.includes(q)) : AREA_ICON_KEYS;
  }, [query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" className="w-fit justify-start gap-2 font-normal">
          <AreaIcon icon={value} className="size-4" />
          <span className="font-mono text-xs text-muted-foreground">{value}</span>
          <ChevronDown className="size-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tc("searchIcons")} autoFocus className="mb-3 h-8" />
        {keys.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">{tc("noResults")}</p>
        ) : (
          <div className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto pr-1">
            {keys.map((key) => (
              <button
                key={key}
                type="button"
                title={key}
                aria-label={key}
                aria-pressed={value === key}
                onClick={() => {
                  onChange(key);
                  setOpen(false);
                }}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md border border-transparent transition-colors hover:bg-accent",
                  value === key && "border-primary bg-primary/10 text-primary",
                )}
              >
                <AreaIcon icon={key} className="size-4" />
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
