/**
 * Magic-link delivery over Resend's HTTP API. Chosen because it is a plain
 * `fetch` — no SDK, no MIME assembly, works from any Worker. When Cloudflare
 * Email Sending's binding reaches GA this is the one file to swap.
 *
 * Configuration is explicit: without RESEND_API_KEY (and outside echo mode)
 * the auth endpoint answers 501 — it never pretends to have sent mail.
 */
import type { MagicLinkSender } from "./ports";

export function resendMagicLinkSender(
  apiKey: string,
  from: string,
  appOrigin: string,
): MagicLinkSender {
  return {
    async send(email, token) {
      // The https link is the ONE link: mail clients reliably linkify it, and
      // the page it opens (landing /sync/login) fires the readaware:// deep
      // link into the app, with a copyable token as fallback. A raw custom-
      // scheme link would not even be clickable in most clients. The token
      // rides the URL fragment, which never reaches the landing's server —
      // and pasting this whole link into the app also works (the token field
      // parses it).
      const webLink = `${appOrigin}/sync/login#${token}`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Sign in to ReadAware Sync",
          text: [
            "Click this link to finish signing in to ReadAware:",
            "",
            webLink,
            "",
            "If it does not open the app, paste the link into ReadAware's Data & Sync settings instead.",
            "",
            "The link expires in 15 minutes. If you did not request it, ignore this email.",
          ].join("\n"),
        }),
      });
      if (!res.ok) {
        throw new Error(`magic-link email failed: ${res.status} ${await res.text()}`);
      }
    },
  };
}
