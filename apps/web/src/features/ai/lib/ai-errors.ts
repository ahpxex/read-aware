/**
 * Typed failures thrown by the AI entry points (chat transport, dictionary
 * lookup). All AI failures are `AppError`s carrying a stable `ai/*` code from
 * @read-aware/core: provider failures get theirs from `classifyModelFailure`
 * in @read-aware/agent, and the one pre-flight case — nothing configured at
 * all — is thrown here. UI code renders localized copy per code via
 * `describeErrorCode`; the `message` is developer-facing English for the log,
 * never something to show verbatim.
 */
import { AppError, ERR_AI_NOT_CONFIGURED } from "@read-aware/core";

export class AiNotConfiguredError extends AppError {
  constructor() {
    super(ERR_AI_NOT_CONFIGURED, "AI is not configured — add an API key in Settings → AI.");
    this.name = "AiNotConfiguredError";
  }
}
