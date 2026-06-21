// Waitlist signup against the Loops newsletter-form endpoint. The transport
// (form id, urlencoded body shape, client rate limit, Cloudflare handling) is
// extracted from the Loops embed snippet; the UI is rendered on-brand instead.

const ENDPOINT =
  "https://app.loops.so/api/newsletter-form/cmil6kut90l9t2j0i9f4uurvp";

const RATE_LIMIT_KEY = "loops-form-timestamp";
const RATE_LIMIT_MS = 60_000;

const RATE_LIMIT_MESSAGE =
  "Too many signups, please try again in a little while";

export type WaitlistOutcome =
  | { status: "success" }
  | { status: "error"; message: string };

export async function joinWaitlist(email: string): Promise<WaitlistOutcome> {
  // Throttle repeat submissions from the same browser.
  const now = Date.now();
  const previous = Number(localStorage.getItem(RATE_LIMIT_KEY) ?? "0");
  if (previous && previous + RATE_LIMIT_MS > now) {
    return { status: "error", message: RATE_LIMIT_MESSAGE };
  }
  localStorage.setItem(RATE_LIMIT_KEY, String(now));

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `userGroup=&mailingLists=&email=${encodeURIComponent(email)}`,
    });

    if (response.ok) {
      return { status: "success" };
    }

    let message = response.statusText;
    try {
      const data = await response.json();
      if (data?.message) message = data.message;
    } catch {
      // Non-JSON error response — fall back to the status text.
    }
    return { status: "error", message };
  } catch (error) {
    // Cloudflare rate-limit blocks surface as "Failed to fetch".
    if (error instanceof Error && error.message === "Failed to fetch") {
      return { status: "error", message: RATE_LIMIT_MESSAGE };
    }
    // Allow an immediate retry after an unexpected network failure.
    localStorage.setItem(RATE_LIMIT_KEY, "");
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Something went wrong, please try again",
    };
  }
}
