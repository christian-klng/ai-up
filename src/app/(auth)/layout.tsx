import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getAppSettings } from "@/server/domain/settings";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { BrandLogo } from "@/components/shell/brand-logo";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const settings = await getAppSettings();
  const t = await getTranslations("common");
  return (
    <div className="min-h-svh flex flex-col bg-muted/40">
      <header className="flex items-center justify-between px-6 py-4">
        <Link href="/login" className="flex items-center gap-3">
          <BrandLogo settings={settings} size={32} />
          <span className="font-semibold tracking-tight">{settings.name}</span>
        </Link>
        <LocaleSwitcher label={t("language")} />
      </header>
      <main className="flex-1 flex items-start sm:items-center justify-center px-4 pb-16 pt-6">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
