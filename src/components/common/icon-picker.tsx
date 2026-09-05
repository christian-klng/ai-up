"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { AREA_ICON_KEYS, AreaIcon } from "@/components/knowledge/area-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type IconComponent = React.ComponentType<{ icon: string; className?: string }>;

/** Searchable dropdown for the ~100 collection/meeting-space/template icons (flat grids got too big). */
export function IconPicker({
  value,
  onChange,
  id,
  keys: allKeys = AREA_ICON_KEYS,
  Icon = AreaIcon,
  disabled,
}: {
  value: string;
  onChange: (icon: string) => void;
  id?: string;
  /** icon key set; defaults to the collection icons */
  keys?: readonly string[];
  /** renderer for a key of `keys`; defaults to AreaIcon */
  Icon?: IconComponent;
  disabled?: boolean;
}) {
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const keys = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? allKeys.filter((k) => k.includes(q)) : allKeys;
  }, [allKeys, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" disabled={disabled} className="w-fit justify-start gap-2 font-normal">
          <Icon icon={value} className="size-4" />
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
                <Icon icon={key} className="size-4" />
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
