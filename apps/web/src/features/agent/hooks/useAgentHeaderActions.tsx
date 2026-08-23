import { lazy, Suspense } from "react";
import { ChatsCircle, Notebook, Plus } from "@phosphor-icons/react";
import { IconButton, Tooltip } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { LibraryBook } from "../../library/lib/library-types";
import type { HeaderActionEntry } from "../../navigation/lib/header-actions";
import { agentHeaderActionClass } from "../lib/agent-header-action";

// Entry METADATA (ids, labels, icons) must exist synchronously for the
// header's collapse math; only the popovers themselves are code-split.
const ThreadsPopover = lazy(() =>
  import("../components/ThreadsPopover").then((m) => ({
    default: m.ThreadsPopover,
  })),
);
const AnnotationsPopover = lazy(() =>
  import("../components/AnnotationsPopover").then((m) => ({
    default: m.AnnotationsPopover,
  })),
);

/**
 * The Agent page's header actions, atomized (see HeaderActionEntry): new
 * conversation, the thread switcher, and the annotations browser. Each can
 * collapse independently into the dots menu on narrow windows — the popover
 * widgets ride along as `node` entries and open from the menu panel.
 */
export function useAgentHeaderActions({
  books,
  onOpenBook,
  onNewConversation,
}: {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
  onNewConversation: () => void;
}): HeaderActionEntry[] {
  const { t } = useTranslation("ai");

  return [
    {
      id: "context:new-conversation",
      inline: (
        <Tooltip content={t("agent.threads.new")} side="bottom">
          <IconButton
            size="sm"
            label={t("agent.threads.new")}
            onClick={onNewConversation}
            className={agentHeaderActionClass}
            icon={<Plus size={16} weight="regular" aria-hidden="true" />}
          />
        </Tooltip>
      ),
      overflow: {
        id: "context:new-conversation",
        label: t("agent.threads.new"),
        icon: <Plus size={16} weight="regular" aria-hidden="true" />,
        run: onNewConversation,
      },
    },
    {
      id: "context:threads",
      inline: (
        <Suspense fallback={null}>
          <ThreadsPopover />
        </Suspense>
      ),
      overflow: {
        id: "context:threads",
        label: t("agent.threads.title"),
        icon: <ChatsCircle size={16} weight="regular" aria-hidden="true" />,
        node: (
          <Suspense fallback={null}>
            <ThreadsPopover />
          </Suspense>
        ),
      },
    },
    {
      id: "context:annotations",
      inline: (
        <Suspense fallback={null}>
          <AnnotationsPopover books={books} onOpenBook={onOpenBook} />
        </Suspense>
      ),
      overflow: {
        id: "context:annotations",
        label: t("agent.annotations.title"),
        icon: <Notebook size={16} weight="regular" aria-hidden="true" />,
        node: (
          <Suspense fallback={null}>
            <AnnotationsPopover books={books} onOpenBook={onOpenBook} />
          </Suspense>
        ),
      },
    },
  ];
}
