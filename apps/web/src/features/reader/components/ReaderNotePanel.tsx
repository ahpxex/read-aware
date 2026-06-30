import { Tabs } from "@read-aware/ui";
import { AnnotationsPanel } from "../../annotations/components/AnnotationsPanel";
import { ChatPanel } from "../../ai/components/ChatPanel";
import type { NotesTab } from "../lib/reader-panel-layout";
import type { TocEntry } from "../lib/reader-types";

/** Tab order ↔ index mapping for the controlled `Tabs` (Chat first, then Notes). */
const TAB_ORDER: NotesTab[] = ["chat", "notes"];

type ReaderNotePanelProps = {
  bookId: string;
  bookTitle: string;
  /** Whether the panel is revealed — gates the Notes data fetch. */
  enabled: boolean;
  activeTab: NotesTab;
  onTabChange: (tab: NotesTab) => void;
  tocEntries: TocEntry[];
  onNavigateTo: (cfiRange: string) => void;
};

/**
 * The right-hand panel's two surfaces: reading annotations and the book's AI
 * conversation, behind a controlled tab. Selection's "Ask AI about this" drives
 * `activeTab` to "chat" from the reader shell; both panels stay mounted so each
 * keeps its scroll position and in-flight state when switching.
 */
export function ReaderNotePanel({
  bookId,
  bookTitle,
  enabled,
  activeTab,
  onTabChange,
  tocEntries,
  onNavigateTo,
}: ReaderNotePanelProps) {
  const activeIndex = Math.max(0, TAB_ORDER.indexOf(activeTab));

  return (
    <Tabs
      fill
      variant="underline"
      ariaLabel="Notes and AI chat"
      className="pt-1"
      tabListClassName="justify-end gap-5 px-4"
      activeIndex={activeIndex}
      onActiveIndexChange={(index) => onTabChange(TAB_ORDER[index] ?? "notes")}
      items={[
        {
          label: "Chat",
          content: (
            <ChatPanel
              bookId={bookId}
              bookTitle={bookTitle}
              active={enabled && activeTab === "chat"}
            />
          ),
        },
        {
          label: "Notes",
          content: (
            <AnnotationsPanel
              bookId={bookId}
              enabled={enabled && activeTab === "notes"}
              tocEntries={tocEntries}
              onNavigateTo={onNavigateTo}
            />
          ),
        },
      ]}
    />
  );
}
