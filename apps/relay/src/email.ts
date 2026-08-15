/**
 * Magic-link delivery over Resend's HTTP API. Chosen because it is a plain
 * `fetch` — no SDK, no MIME assembly, works from any Worker. When Cloudflare
 * Email Sending's binding reaches GA this is the one file to swap.
 *
 * Configuration is explicit: without RESEND_API_KEY (and outside echo mode)
 * the auth endpoint answers 501 — it never pretends to have sent mail.
 */
import { EMAIL } from "./i18n";
import type { MagicLinkSender } from "./ports";

export function resendMagicLinkSender(
  apiKey: string,
  from: string,
  appOrigin: string,
): MagicLinkSender {
  return {
    async send(email, token, lang) {
      // The https link is the ONE link: mail clients reliably linkify it, and
      // the page it opens (landing /sync/login) fires the readaware:// deep
      // link into the app, with a copyable token as fallback. A raw custom-
      // scheme link would not even be clickable in most clients. The token
      // rides the URL fragment, which never reaches the landing's server —
      // and pasting this whole link into the app also works (the token field
      // parses it). The lang rides the query so the landing page renders in
      // the requesting device's locale.
      const t = EMAIL[lang];
      const webLink = `${appOrigin}/sync/login?lang=${encodeURIComponent(lang)}#${token}`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: t.subject,
          text: [t.click, "", webLink, "", t.fallback, "", t.expires].join("\n"),
        }),
      });
      if (!res.ok) {
        throw new Error(`magic-link email failed: ${res.status} ${await res.text()}`);
      }
    },
  };
}
