"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type AdminNavItem = { href: string; label: string; badge?: number; disabled?: boolean };

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Admin">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const cls = cn(
          "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm",
          active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          item.disabled && "pointer-events-none opacity-50",
        );
        const badge = item.badge ? (
          <span className="ml-auto rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground">{item.badge}</span>
        ) : null;
        return item.disabled ? (
          <span key={item.href} className={cls} aria-disabled>
            {item.label}
          </span>
        ) : (
          <Link key={item.href} href={item.href} className={cls} aria-current={active ? "page" : undefined}>
            {item.label}
            {badge}
          </Link>
        );
      })}
    </nav>
  );
}
