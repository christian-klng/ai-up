import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { getAppSettings } from "@/server/domain/settings";
import { themeCss } from "@/lib/theme";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getAppSettings();
  return {
    title: { default: settings.name, template: `%s · ${settings.name}` },
    description: settings.tagline ?? undefined,
    icons: settings.faviconMediaId ? [{ url: `/api/files/${settings.faviconMediaId}` }] : undefined,
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, settings] = await Promise.all([getLocale(), getAppSettings()]);
  return (
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Brand tokens from admin settings – tiny inline stylesheet, no rebuild needed. */}
        <style id="brand-theme" dangerouslySetInnerHTML={{ __html: themeCss(settings.theme) }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme={settings.theme.mode} enableSystem disableTransitionOnChange>
          <NextIntlClientProvider>
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster position="top-right" />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
