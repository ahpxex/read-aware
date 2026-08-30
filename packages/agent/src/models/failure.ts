/**
 * Classification of model/provider failures into stable `AppError` codes.
 *
 * By the time a failure reaches us it is a string: pi-ai's providers collapse
 * HTTP status and SDK error types into `AssistantMessage.errorMessage`, and
 * pi-agent-core re-surfaces that as `agent.state.errorMessage` / a plain
 * thrown Error. There is no structured channel to recover, so this layer does
 * what pi-ai itself does for its retry policy (see its exported
 * `isRetryableAssistantError`): match the message text against the wording the
 * provider ecosystem actually emits, with an honest `ai/unknown` fallback.
 *
 * The classified codes drive real UI differences — an auth failure links to
 * Settings, a rate limit says "wait", and only retryable failures get a retry
 * affordance — so precision matters more than coverage: a pattern belongs
 * here only when the category's copy/affordance would genuinely differ.
 */
import {
  AppError,
  ERR_AI_AUTH,
  ERR_AI_CONTEXT_OVERFLOW,
  ERR_AI_NETWORK,
  ERR_AI_PROVIDER,
  ERR_AI_QUOTA,
  ERR_AI_RATE_LIMITED,
  ERR_AI_UNKNOWN,
} from "@read-aware/core";

/** Ordered: the first matching category wins. */
const CATEGORIES: Array<{ code: string; retryable: boolean; pattern: RegExp }> = [
  {
    // Key problems — fixable in Settings, never by retrying.
    code: ERR_AI_AUTH,
    retryable: false,
    pattern:
      /\b40[13]\b|unauthorized|forbidden|invalid[\s_-]?(api[\s_-]?key|x-api-key|token)|incorrect api key|api key (not valid|expired|missing)|authentication[\s_-]?(error|failed)|no auth credentials/i,
  },
  {
    // Billing/quota exhaustion — terminal until the account changes. Checked
    // before rate limits because providers ship these as 429s too
    // (e.g. OpenAI `insufficient_quota`).
    code: ERR_AI_QUOTA,
    retryable: false,
    pattern:
      /insufficient[\s_-]?quota|exceeded your current quota|quota exceeded|out of budget|billing|credit balance|purchase credits|payment required|\b402\b/i,
  },
  {
    // Transient throttling — retry after a pause is the honest advice.
    code: ERR_AI_RATE_LIMITED,
    retryable: true,
    pattern: /\b429\b|rate[\s_-]?limit|too many requests|resource[\s_-]?exhausted|overloaded/i,
  },
  {
    // The request itself is too large for the model — retrying identically
    // cannot succeed.
    code: ERR_AI_CONTEXT_OVERFLOW,
    retryable: false,
    pattern:
      /context[\s_-]?(length|window)|maximum context|prompt is too long|too many tokens|input (is too long|length)|max_tokens|token limit/i,
  },
  {
    // Provider-side transient failures (5xx family and its prose).
    code: ERR_AI_PROVIDER,
    retryable: true,
    pattern:
      /\b50[0-4]\b|\b52[24]\b|server[\s_-]?error|internal[\s_-]?error|service[\s_-]?unavailable|bad gateway|provider[\s_-]?returned[\s_-]?error/i,
  },
  {
    // Transport failures. "Load failed" is WKWebView's fetch rejection text —
    // the message desktop users actually see when offline.
    code: ERR_AI_NETWORK,
    retryable: true,
    pattern:
      /fetch failed|failed to fetch|load failed|network[\s_-]?(error|failure)|connection[\s_-]?(error|refused|lost|closed)|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|getaddrinfo|socket|timed?[\s_-]?out|timeout|other side closed|stream ended (without|before)/i,
  },
];

/**
 * Wrap a provider failure (a thrown value or a bare `errorMessage` string) in
 * an `AppError` with a stable `ai/*` code. Idempotent: an already-coded
 * `AppError` passes through untouched, so double-classification at nested
 * boundaries can't clobber a more specific code.
 */
export function classifyModelFailure(raw: unknown): AppError {
  if (raw instanceof AppError) return raw;
  const message =
    raw instanceof Error ? raw.message : typeof raw === "string" ? raw : String(raw);
  const category = CATEGORIES.find((entry) => entry.pattern.test(message));
  return new AppError(category?.code ?? ERR_AI_UNKNOWN, message || "model call failed", {
    retryable: category?.retryable ?? false,
    cause: raw instanceof Error ? raw : undefined,
  });
}
