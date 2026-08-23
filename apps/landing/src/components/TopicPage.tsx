import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DownloadMenu } from "./DownloadMenu";
import { DownloadSection } from "./DownloadSection";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { useDocumentLang } from "../hooks/useDocumentLang";
import { useLatestRelease } from "../hooks/useLatestRelease";
import { useSiteCopy } from "../i18n/use-site-copy";
import { TOPIC_PAGES } from "../lib/topic-pages";

export type TopicFaq = { question: string; answer: string };

/**
 * The frame every topic page (lib/topic-pages.ts) renders inside: headline,
 * lead, an immediate download call-to-action (someone arriving from a search
 * came to get the app, not to scroll for the button), the page's own prose,
 * a visible FAQ, links to the sibling topic pages, and the full download
 * section. The FAQ is also emitted as FAQPage JSON-LD — same strings as the
 * visible answers, so the structured data can never say more than the page.
 */
export function TopicPage({
  title,
  lead,
  faqs,
  children,
}: {
  title: string;
  lead: string;
  faqs: TopicFaq[];
  children: ReactNode;
}) {
  useDocumentLang("en");
  const { t } = useTranslation("site");
  const release = useLatestRelease();
  const content = useSiteCopy("home");
  const downloadStrings = {
    ...content.download,
    latest: (tag: string) => t("home.download.latest", { tag }),
    downloadFor: (name: string) => t("home.download.downloadFor", { name }),
  };
  const freeLine = release.tag
    ? t("home.freeLineWithTag", { tag: release.tag })
    : t("home.freeLine");
  const pathname = useLocation({ select: (location) => location.pathname });
  const currentPath = pathname.replace(/\/$/, "") || "/";
  const siblings = TOPIC_PAGES.filter((page) => page.path !== currentPath);

  return (
    <div className="min-h-screen bg-paper text-fg">
      <div className="mx-auto max-w-3xl px-6">
        <SiteHeader locale="en" />

        <main className="max-w-[40rem] pb-12 pt-6 sm:pt-8">
          <article>
            <header>
              <h1 className="text-[clamp(1.9rem,4.2vw,2.6rem)] font-normal leading-[1.15] tracking-[-0.01em]">
                {title}
              </h1>
              <p className="mt-5 text-[1.125rem] leading-[1.75] text-fg">{lead}</p>
              <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
                <DownloadMenu
                  downloads={release.downloads}
                  platform={release.platform}
                  strings={downloadStrings}
                />
                <span className="text-[0.9375rem] text-fg-muted">
                  {freeLine}
                </span>
              </div>
            </header>

            <div className="doc-prose mt-10">{children}</div>

            <section className="mt-14">
              <h2 className="text-[1.375rem] font-medium leading-[1.25] tracking-[-0.01em]">
                Questions
              </h2>
              <dl className="mt-4">
                {faqs.map(({ question, answer }, index) => (
                  <div
                    key={question}
                    className={index === 0 ? "py-4" : "border-t border-border py-4"}
                  >
                    <dt className="text-[1.0625rem] font-medium">{question}</dt>
                    <dd className="mt-1.5 text-[1.0625rem] leading-[1.7] text-fg-muted">
                      {answer}
                    </dd>
                  </div>
                ))}
              </dl>
              <FaqJsonLd faqs={faqs} />
            </section>

            <p className="mt-12 text-[0.9375rem] leading-[1.9] text-fg-muted">
              More about ReadAware:{" "}
              {siblings.map((page, index) => (
                <span key={page.path}>
                  {index > 0 && " · "}
                  <Link
                    to={page.path}
                    className="underline underline-offset-4 transition-colors hover:text-fg"
                  >
                    {page.label}
                  </Link>
                </span>
              ))}
              {" · "}
              <Link
                to="/"
                className="underline underline-offset-4 transition-colors hover:text-fg"
              >
                ReadAware
              </Link>
            </p>
          </article>

          <DownloadSection
            downloads={release.downloads}
            platform={release.platform}
            tag={release.tag}
            strings={downloadStrings}
          />
        </main>

        <SiteFooter locale="en" />
      </div>
    </div>
  );
}

/**
 * FAQPage structured data, from the same strings the visible FAQ renders.
 * Lives in the body markup — valid for JSON-LD — so the prerendered HTML and
 * the client-rendered page carry it identically with no prerender-script
 * involvement.
 */
function FaqJsonLd({ faqs }: { faqs: TopicFaq[] }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
  return (
    <script
      type="application/ld+json"
      // < keeps a literal "</script>" inside string values from closing the tag.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
