/**
 * What an empty Agent conversation shows: a serif heading and a line on what
 * the page is for, a few ways in (a different mix each conversation, see
 * `pickWelcomeSuggestions`), and the keys for the page's own controls. A way
 * in fills the composer (never sends), so it can be edited first.
 */
import type { ReactNode } from "react";
import { EmptyState, Kbd } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { WelcomeSuggestionKey } from "../lib/welcome-suggestions";

export type AgentWelcomeProps = {
  /** The ways in to offer. */
  suggestions: WelcomeSuggestionKey[];
  /** Put a prompt in the composer. */
  onSuggest: (prompt: string) => void;
  /** The live keys of the search (here: the thread palette) and new-conversation shortcuts. */
  searchKeys: string[];
  newConversationKeys: string[];
};

export function AgentWelcome({ suggestions, onSuggest, searchKeys, newConversationKeys }: AgentWelcomeProps) {
  const { t } = useTranslation("ai");
  return (
    <EmptyState
      className="w-full max-w-xl py-0"
      size="display"
      title={t("chat.globalEmpty.title")}
      description={t("chat.globalEmpty.description")}
      action={
        <div className="flex w-full flex-col items-center gap-5">
          <ul className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            {suggestions.map((key) => {
              const prompt = t(`agent.welcome.suggestions.${key}`);
              return (
                <li key={key}>
                  {/* oxlint-disable-next-line react/forbid-elements -- a prompt card: wraps two lines, unlike Button's fixed height */}
                  <button
                    type="button"
                    onClick={() => onSuggest(prompt)}
                    className="h-full w-full rounded-md border border-border px-3 py-2.5 text-left font-sans text-sm text-fg-muted transition-colors hover:bg-fg/5 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
                  >
                    {prompt}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-sans text-xs text-fg-subtle">
            <Hint keys={searchKeys}>{t("agent.threads.search")}</Hint>
            <Hint keys={newConversationKeys}>{t("agent.threads.new")}</Hint>
          </p>
        </div>
      }
    />
  );
}

function Hint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex items-center gap-0.5">
        {keys.map((key, index) => (
          <Kbd key={index}>{key}</Kbd>
        ))}
      </span>
      {children}
    </span>
  );
}
