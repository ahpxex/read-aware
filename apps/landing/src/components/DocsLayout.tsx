import { Outlet } from "@tanstack/react-router";
import { useDocumentLang } from "../hooks/useDocumentLang";
import type { Locale } from "../lib/i18n";
import { DocsNav } from "./DocsNav";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/** The docs shell, shared by every locale's /docs layout route. */
export function DocsLayout({ locale }: { locale: Locale }) {
  useDocumentLang(locale);

  return (
    <div className="min-h-screen bg-paper text-fg">
      <div className="mx-auto max-w-4xl px-6">
        <SiteHeader locale={locale} />
        <div className="pb-12 pt-6 sm:pt-8 md:grid md:grid-cols-[10.5rem_minmax(0,1fr)] md:gap-12">
          <DocsNav locale={locale} />
          <main className="mt-10 min-w-0 md:mt-0">
            <Outlet />
          </main>
        </div>
        <SiteFooter locale={locale} />
      </div>
    </div>
  );
}
