import { Outlet } from "@tanstack/react-router";
import { useDocumentLang } from "../hooks/useDocumentLang";
import type { Locale } from "../lib/i18n";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/** The blog shell, shared by every locale's /blog layout route. */
export function BlogLayout({ locale }: { locale: Locale }) {
  useDocumentLang(locale);

  return (
    <div className="min-h-screen bg-paper text-fg">
      <div className="mx-auto max-w-3xl px-6">
        <SiteHeader locale={locale} />
        <main className="max-w-[40rem] pb-12 pt-6 sm:pt-8">
          <Outlet />
        </main>
        <SiteFooter locale={locale} />
      </div>
    </div>
  );
}
