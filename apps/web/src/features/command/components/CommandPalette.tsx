import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { buildCommands, type CommandContext, type CommandItem } from "../lib/build-commands";
import { filterCommands } from "../lib/filter-commands";

type CommandPaletteProps = {
  isOpen: boolean;
  onClose: () => void;
  ctx: CommandContext;
};

/**
 * Command center (⌘K): one search box over books, collections, navigation, and
 * shelf controls. The available commands are built dynamically from the current
 * context, ranked by query relevance, and grouped into sections.
 */
export function CommandPalette({ isOpen, onClose, ctx }: CommandPaletteProps) {
  const { t } = useTranslation("command");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () => (isOpen ? buildCommands(ctx, t) : []),
    // Rebuild when the underlying data changes (actions are stable setters) or
    // the language switches (labels/keywords are translated).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, ctx.activeTopNav, ctx.shelfView, ctx.collections, ctx.books, t],
  );
  const groups = useMemo(() => filterCommands(items, query), [items, query]);
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setSelectedIndex(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex((index) => (flat.length === 0 ? 0 : Math.min(index, flat.length - 1)));
  }, [flat.length]);

  const run = useCallback(
    (item: CommandItem) => {
      item.perform();
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => (flat.length ? (index + 1) % flat.length : 0));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => (flat.length ? (index - 1 + flat.length) % flat.length : 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = flat[selectedIndex];
        if (item) run(item);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, flat, selectedIndex, onClose, run]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, groups]);

  if (!isOpen) return null;

  let runningIndex = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-stone-950/35 px-4 py-[15vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "flex w-full max-w-xl flex-col border border-border bg-[var(--ra-main-surface-color)]",
          "shadow-[0_12px_32px_rgba(28,25,23,0.15)]",
          "animate-in fade-in slide-in-from-top-2 duration-200",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <MagnifyingGlass size={20} weight="regular" className="text-fg-subtle" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search.placeholder")}
            className="flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>

        <div ref={listRef} className="max-h-[55vh] overflow-y-auto py-2">
          {flat.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-fg-muted">
              {t("noMatches", { query })}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.group} className="mb-1">
                <div className="px-4 pb-1 pt-2 text-xs lowercase text-fg-subtle">
                  {t(`groups.${group.group}`)}
                </div>
                {group.items.map((item) => {
                  runningIndex += 1;
                  const index = runningIndex;
                  const selected = index === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-index={index}
                      aria-selected={selected}
                      onMouseMove={() => setSelectedIndex(index)}
                      onClick={() => run(item)}
                      className={cn(
                        "relative flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                        selected ? "bg-fg/[0.07]" : "hover:bg-fg/[0.04]",
                      )}
                    >
                      {selected && (
                        <span
                          className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-fg"
                          aria-hidden="true"
                        />
                      )}
                      <span className="flex h-9 w-7 shrink-0 items-center justify-center overflow-hidden rounded-sm">
                        {item.kind === "book" && item.coverUrl ? (
                          <img src={item.coverUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-7 w-7 items-center justify-center text-fg-muted">
                            {item.icon}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">
                          {item.title}
                        </span>
                        {item.subtitle && (
                          <span className="block truncate text-xs text-fg-muted">
                            {item.subtitle}
                          </span>
                        )}
                      </span>
                      {selected && (
                        <span className="shrink-0 text-xs text-fg-subtle" aria-hidden="true">
                          ↵
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-fg-subtle">
          <span>{t("results", { count: flat.length })}</span>
          <div className="flex gap-3">
            <span>{t("footer.navigate")}</span>
            <span>{t("footer.run")}</span>
            <span>{t("footer.close")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
