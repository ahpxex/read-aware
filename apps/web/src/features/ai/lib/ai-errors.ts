/**
 * Typed failures thrown by the AI entry points (chat transport, dictionary
 * lookup). UI code matches on `code` and renders localized, actionable copy —
 * `message` is a developer-facing English fallback for logs and unknown
 * consumers, never something to show verbatim in a localized surface.
 */

/** No provider/API key configured — fixable by the user in Settings → AI. */
export const AI_NOT_CONFIGURED = "ai-not-configured";

export class AiNotConfiguredError extends Error {
  readonly code = AI_NOT_CONFIGURED;

  constructor() {
    super("AI is not configured — add an API key in Settings → AI.");
    this.name = "AiNotConfiguredError";
  }
}
