import { ArrowArcLeft, ArrowArcRight } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useTranslation } from "../../../i18n";
import { stepReadingHistory, useReadingHistory } from "../../reader";
import type { CommandItem } from "../lib/build-commands";

/** Back / forward through the open book's jump history, while a book is open. */
export function useReadingHistoryCommands(active: boolean): CommandItem[] {
  const history = useReadingHistory(active),
    { t } = useTranslation("reader");
  return useMemo(() => {
    if (!history.ready) return [];
    return (["back", "forward"] as const).map(
      (direction) =>
        ({
          id: `reading-history:${direction}`,
          kind: "action",
          group: "goto",
          title: t(direction === "back" ? "historyBack" : "historyForward"),
          icon:
            direction === "back" ? (
              <ArrowArcLeft size={16} weight="regular" aria-hidden="true" />
            ) : (
              <ArrowArcRight size={16} weight="regular" aria-hidden="true" />
            ),
          disabled: direction === "back" ? !history.canGoBack : !history.canGoForward,
          perform: (signal?: AbortSignal) => stepReadingHistory(direction, "user", signal),
        }) satisfies CommandItem,
    );
  }, [history, t]);
}
