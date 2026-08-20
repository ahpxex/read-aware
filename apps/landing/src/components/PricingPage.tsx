import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { useDocumentLang } from "../hooks/useDocumentLang";
import type { Locale } from "../lib/i18n";
import { PRICING, type PricingPlan } from "../lib/pricing-content";
import { CONTACT_EMAIL, RELAY_URL } from "../lib/site";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * The pricing page, rendered from the PRICING registry — one component for
 * every locale, like the changelog. Wider container than the landing column
 * (max-w-4xl, the docs width) so the four plans sit as one readable ladder;
 * ink-on-paper otherwise: no accent color, the recommended plan earns only a
 * stronger border and a quiet label.
 *
 * Paid cards start a signed-OUT checkout: the relay mints a Stripe session,
 * Stripe collects the email, and the webhook keys fulfillment to it — the
 * buyer signs into the app with the same address and lands upgraded. In-app
 * (signed-in) checkout lives in the desktop settings instead.
 */
export function PricingPage({ locale }: { locale: Locale }) {
  useDocumentLang(locale);
  const copy = PRICING[locale];

  // Stripe bounces back here with ?purchase=success (prerendered HTML never
  // carries the query, so read it lazily on the client only).
  const [purchased] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("purchase") === "success",
  );
  const [busyPlan, setBusyPlan] = useState<PricingPlan["id"] | null>(null);
  const [checkoutError, setCheckoutError] = useState(false);

  const startCheckout = async (plan: PricingPlan["id"]) => {
    if (busyPlan) return;
    setBusyPlan(plan);
    setCheckoutError(false);
    try {
      const res = await fetch(`${RELAY_URL}/v1/billing/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, locale: locale === "en" ? undefined : locale }),
      });
      const { url } = (await res.json()) as { url?: string };
      if (!res.ok || !url) throw new Error(`checkout answered ${res.status}`);
      window.location.assign(url);
    } catch {
      setCheckoutError(true);
      setBusyPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-paper text-fg">
      <div className="mx-auto max-w-4xl px-6">
        <SiteHeader locale={locale} />
        <main className="pb-12 pt-6 sm:pt-8">
          <h1 className="text-[2rem] font-medium tracking-tight">{copy.title}</h1>
          <p className="mt-3 max-w-[40rem] text-[1.0625rem] leading-relaxed text-fg-muted">
            {copy.lead}
          </p>

          {purchased && (
            <p
              role="status"
              className="mt-6 max-w-[40rem] rounded-md border border-border-strong bg-surface px-4 py-3 text-[0.9375rem] leading-relaxed"
            >
              {copy.purchaseSuccess}
            </p>
          )}

          {/* Subgrid ladder: the outer grid owns five shared row tracks —
              name, price, tagline, features, CTA — and every card spans them
              (`grid-rows-subgrid`), so dividers, list starts, and footers sit
              on the same line across cards regardless of copy length. The
              outer grid keeps row-gap 0 (a row gap would open the cards'
              internal seams too); card separation between bands comes from a
              uniform card margin instead. */}
          <div className="mt-6 grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
            {copy.plans.map((plan) => (
              <section
                key={plan.id}
                className={cn(
                  "mt-4 grid row-span-5 grid-rows-subgrid rounded-md border bg-surface p-5",
                  plan.highlight ? "border-border-strong" : "border-border",
                )}
              >
                {/* Header — rows 1-3: identity, price, pitch. */}
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-[1.0625rem] font-medium tracking-tight">
                    {plan.name}
                  </h2>
                  {plan.highlight && (
                    <span className="text-[0.75rem] text-fg-subtle">
                      {copy.recommended}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-[1.75rem] font-medium tracking-tight">
                  {plan.price}
                  <span className="ml-1 text-[0.875rem] font-normal text-fg-subtle">
                    {copy.perMonth}
                  </span>
                </p>
                <p className="mt-2 mb-4 text-[0.875rem] leading-relaxed text-fg-muted">
                  {plan.tagline}
                </p>
                {/* Body — row 4: the divider tops the shared track, one line
                    across all cards. */}
                <ul className="flex flex-col gap-2 border-t border-border pt-4 text-[0.875rem] leading-relaxed text-fg-muted">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <Check
                        size={14}
                        weight="bold"
                        aria-hidden="true"
                        className="mt-[0.3rem] shrink-0 text-fg-subtle"
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                {/* Footer — row 5: every plan gets the same button-shaped
                    slot; the free plan's is a download link wearing it. */}
                <div className="self-end pt-5">
                  {plan.id === "free" ? (
                    <Link
                      to="/"
                      hash="download"
                      className="block w-full rounded-md border border-border-strong px-4 py-2 text-center text-[0.9375rem] text-fg transition-colors hover:bg-fill"
                    >
                      {copy.ctaFree}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void startCheckout(plan.id)}
                      disabled={busyPlan !== null}
                      className={cn(
                        "w-full rounded-md px-4 py-2 text-[0.9375rem] transition-colors",
                        plan.highlight
                          ? "bg-fg text-inverse-fg hover:opacity-90"
                          : "border border-border-strong text-fg hover:bg-fill",
                        busyPlan !== null && "opacity-60",
                      )}
                    >
                      {busyPlan === plan.id ? copy.ctaPaidBusy : copy.ctaPaid}
                    </button>
                  )}
                </div>
              </section>
            ))}
          </div>

          <p className="mt-6 text-[0.9375rem] leading-relaxed text-fg-muted">
            {checkoutError && (
              <span className="mr-2 text-fg" role="alert">
                {copy.checkoutFailed}
              </span>
            )}
            {copy.paidNote}{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-fg underline underline-offset-4 transition-colors hover:text-fg-muted"
            >
              {copy.paidNoteLink}
            </a>
          </p>

          <section className="mt-14 max-w-[40rem]">
            <h2 className="text-[1.375rem] font-medium tracking-tight">
              {copy.finePrintTitle}
            </h2>
            <ul className="mt-4 flex flex-col gap-3 text-[0.9375rem] leading-relaxed text-fg-muted">
              {copy.finePrint.map((item) => (
                <li key={item} className="border-l-2 border-border pl-4">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </main>
        <SiteFooter locale={locale} />
      </div>
    </div>
  );
}
