/**
 * The screen of last resort for a failed boot. If anything in main.tsx's boot
 * sequence throws, React never mounts, the router's error boundary never
 * renders, and — before this existed — the user sat behind the #ra-splash
 * wordmark forever with zero trace. This paints a plain-DOM failure notice in
 * the splash's place instead: no React, no i18n (both may be exactly what
 * failed), just inline styles on the already-themed splash surface.
 *
 * English-only by design: it can render before the locale system exists, and
 * its audience is "someone about to paste these details into a report".
 */

function describeBootError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack && error.stack.includes(error.message)
      ? error.stack
      : [`${error.name}: ${error.message}`, error.stack ?? ""].filter(Boolean).join("\n");
  }
  return String(error);
}

export function showBootFailure(error: unknown): void {
  const details = describeBootError(error);

  const host = document.getElementById("ra-splash") ?? document.body;
  // A splash mid-fade must come back: the failure notice is now the screen.
  host.classList.remove("ra-splash-leave");

  const container = document.createElement("div");
  container.style.cssText =
    "max-width:34rem;padding:2rem;text-align:left;font-family:ui-sans-serif,system-ui,sans-serif;";
  container.innerHTML = `
    <p style="margin:0;font-size:11px;font-weight:500;opacity:.6;">ReadAware</p>
    <h1 style="margin:.5rem 0 0;font-family:ui-serif,Georgia,serif;font-size:1.6rem;font-weight:600;">Could not start</h1>
    <p style="margin:.75rem 0 0;font-size:.9rem;line-height:1.6;opacity:.75;">
      An error stopped ReadAware before it could open. The details below are also
      written to the log file. Restarting the app may help; if it doesn't, please
      report this from a device that can reach us.
    </p>
    <pre style="margin:1rem 0 0;max-height:14rem;overflow:auto;padding:.9rem 1rem;border:1px solid currentColor;border-radius:.5rem;opacity:.85;font-size:.75rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;-webkit-user-select:all;user-select:all;"></pre>
    <button type="button" style="margin-top:1rem;padding:.5rem 1.1rem;border:1px solid currentColor;border-radius:.5rem;background:transparent;color:inherit;font-size:.85rem;cursor:pointer;">Copy details</button>
  `;
  // The error text goes in via textContent — never innerHTML — so a message
  // containing markup renders inert.
  const pre = container.querySelector("pre");
  if (pre) pre.textContent = details;
  const button = container.querySelector("button");
  button?.addEventListener("click", () => {
    void navigator.clipboard
      .writeText(details)
      .then(() => {
        button.textContent = "Copied";
      })
      .catch(() => {
        // Clipboard unavailable: the <pre> is select-all — manual copy works.
        button.textContent = "Select the text above to copy";
      });
  });

  host.replaceChildren(container);
}
