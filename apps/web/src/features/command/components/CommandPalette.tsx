import { useEffect, useMemo, useState } from "react";
import { Check } from "@phosphor-icons/react";
import { Palette, PaletteGroup, PaletteOption } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { buildCommands, type CommandContext, type CommandItem } from "../lib/build-commands";
import { filterCommands } from "../lib/filter-commands";
import { availableCommandIndex, nextCommandIndex } from "../lib/command-selection";
import { useAtom } from "jotai";
import { commandQueryAtom } from "../../../state/ui";
import { WorkspaceCommit } from "../../../components/WorkspaceCommit";
import { useCommandExecution, type NativeCommandExecutor } from "../hooks/useCommandExecution";
import { useReadingAiCommands } from "../hooks/useReadingAiCommands";
import { useReadingHistoryCommands } from "../hooks/useReadingHistoryCommands";

type CommandPaletteProps = {
  isOpen: boolean;
  onClose: () => void;
  ctx: CommandContext;
  /** Externally contributed items (e.g. plugin actions), appended to the set. */
  extraItems?: CommandItem[];
  workspaceToken?: number;
  executeHost?: NativeCommandExecutor;
};

/**
 * Command center (⌘K): one search box over books, collections, navigation, and
 * shelf controls. The available commands are built dynamically from the current
 * context, ranked by query relevance, and grouped into sections.
 */
export function CommandPalette({
  isOpen,
  onClose,
  ctx,
  extraItems,
  workspaceToken = 0,
  executeHost,
}: CommandPaletteProps) {
  const { t } = useTranslation("command");
  const [query, setQuery] = useAtom(commandQueryAtom);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { run, dismiss, busy } = useCommandExecution(isOpen, onClose, executeHost);
  const readingAiCommands = useReadingAiCommands(isOpen);
  const readingHistoryCommands = useReadingHistoryCommands(isOpen);

  const items = useMemo(
    () =>
      isOpen ? [...buildCommands(ctx, t), ...readingHistoryCommands, ...readingAiCommands, ...(extraItems ?? [])] : [],
    // Rebuild when the underlying data changes (actions are stable setters) or
    // the language switches (labels/keywords are translated).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isOpen,
      ctx.activeTopNav,
      ctx.destinations,
      ctx.readingBookId,
      ctx.shelfView,
      ctx.collections,
      ctx.books,
      ctx.importBook,
      extraItems,
      readingHistoryCommands,
      readingAiCommands,
      t,
    ],
  );
  const groups = useMemo(() => filterCommands(items, query), [items, query]);
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => {
    if (isOpen) setSelectedIndex(0);
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex((index) => availableCommandIndex(flat, index));
  }, [flat]);

  let runningIndex = -1;

  return (
    <>
      {isOpen && <WorkspaceCommit surface="search" token={workspaceToken} />}
      <Palette
        open={isOpen}
        onClose={dismiss}
        searchLabel={t("search.placeholder")}
        query={query}
        onQueryChange={setQuery}
        selectedIndex={selectedIndex}
        onMove={(direction) => setSelectedIndex((index) => nextCommandIndex(flat, index, direction))}
        onRun={() => {
          const item = flat[selectedIndex];
          if (item) void run(item);
        }}
        busy={busy}
        footer={
          <>
            <span>{t("results", { count: flat.length })}</span>
            <div className="flex gap-3">
              <span>{t("footer.navigate")}</span>
              <span>{t("footer.run")}</span>
              <span>{t("footer.close")}</span>
            </div>
          </>
        }
      >
        {flat.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-fg-muted">{t("noMatches", { query })}</div>
        ) : (
          groups.map((group) => (
            <PaletteGroup key={group.group} label={t(`groups.${group.group}`)}>
              {group.items.map((item) => {
                runningIndex += 1;
                const index = runningIndex;
                return (
                  <PaletteOption
                    key={item.id}
                    index={index}
                    selected={index === selectedIndex}
                    disabled={item.disabled || busy}
                    aria-pressed={item.checked}
                    onHover={() => setSelectedIndex(index)}
                    onRun={() => {
                      void run(item);
                    }}
                  >
                    <span className="flex h-9 w-7 shrink-0 items-center justify-center overflow-hidden rounded-mark">
                      {item.kind === "book" && item.coverUrl ? (
                        <img src={item.coverUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-7 w-7 items-center justify-center text-fg-muted">{item.icon}</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
                      {item.subtitle && <span className="block truncate text-xs text-fg-muted">{item.subtitle}</span>}
                    </span>
                    {item.checked && <Check size={16} aria-hidden="true" className="shrink-0" />}
                  </PaletteOption>
                );
              })}
            </PaletteGroup>
          ))
        )}
      </Palette>
    </>
  );
}
