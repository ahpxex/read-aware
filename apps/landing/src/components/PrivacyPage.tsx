import { useDocumentLang } from "../hooks/useDocumentLang";
import type { Locale } from "../lib/i18n";
import { LocalizedDocsPage } from "./LocalizedDocsPage";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * The privacy policy as a standalone legal page: the docs pipeline renders
 * the localized markdown (the docs resources' pages.privacy), but the page
 * lives outside the docs shell — no sidebar, since it is policy, not
 * documentation. App Store listings and the site footer link here.
 */
export function PrivacyPage({ locale }: { locale: Locale }) {
  useDocumentLang(locale);

  return (
    <div className="min-h-screen bg-paper text-fg">
      <div className="mx-auto max-w-4xl px-6">
        <SiteHeader locale={locale} />
        <main className="mx-auto max-w-2xl pb-12 pt-6 sm:pt-8">
          <LocalizedDocsPage page="privacy" />
        </main>
        <SiteFooter locale={locale} />
      </div>
    </div>
  );
}
