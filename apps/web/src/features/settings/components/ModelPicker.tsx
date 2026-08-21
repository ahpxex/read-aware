/**
 * 可搜索的模型选择器：推荐子集置顶、pi-ai 全目录可搜（id/名称），条目带
 * 价格与 reasoning 标记；搜索无匹配时允许把输入原样用作模型 ID（目录
 * 永远追不上上游新模型，自由输入是逃生口）。视觉贴 Select 的 underline
 * 触发器，面板内自管键盘（↑/↓/Enter/Esc + aria-activedescendant）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { getProviderModelCatalog, type KnownProviderId } from "@read-aware/agent";
import { Badge, Caption, SearchField } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";

interface PickerOption {
  id: string;
  name: string;
  reasoning?: boolean;
  cost?: { input: number; output: number };
  recommended?: boolean;
}

interface ModelPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  provider: KnownProviderId;
  /** 精选子集（置顶展示）；全目录来自 pi-ai。 */
  recommended: { label: string; value: string }[];
  helperText?: string;
}

function formatCost(cost: { input: number; output: number }): string {
  const part = (value: number) =>
    value >= 10 ? value.toFixed(0) : value >= 1 ? value.toFixed(1) : value.toFixed(2);
  return `$${part(cost.input)} / $${part(cost.output)} · 1M`;
}

export function ModelPicker({
  label,
  value,
  onChange,
  provider,
  recommended,
  helperText,
}: ModelPickerProps) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const catalog = useMemo(() => {
    const recommendedIds = new Set(recommended.map((option) => option.value));
    const entries = getProviderModelCatalog(provider);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const top: PickerOption[] = recommended.map((option) => ({
      id: option.value,
      name: byId.get(option.value)?.name ?? option.label,
      reasoning: byId.get(option.value)?.reasoning,
      cost: byId.get(option.value)?.cost,
      recommended: true,
    }));
    const rest: PickerOption[] = entries
      .filter((entry) => !recommendedIds.has(entry.id))
      .map((entry) => ({ ...entry }));
    return [...top, ...rest];
  }, [provider, recommended]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter(
      (option) =>
        option.id.toLowerCase().includes(needle) ||
        option.name.toLowerCase().includes(needle),
    );
  }, [catalog, query]);

  /** 无匹配时的自由输入项（把 query 原样当模型 ID）。 */
  const freeEntry = query.trim() && filtered.length === 0 ? query.trim() : null;
  const rowCount = freeEntry ? 1 : filtered.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const commit = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  const onSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, rowCount - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (freeEntry) commit(freeEntry);
      else if (filtered[activeIndex]) commit(filtered[activeIndex].id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const selected = catalog.find((option) => option.id === value);
  const listId = "model-picker-list";

  return (
    <div ref={containerRef} className="relative">
      <span className="mb-1 block text-xs text-fg-muted">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex w-full items-center justify-between gap-2 border-b border-border bg-transparent py-1.5 text-left text-sm text-fg transition-colors",
          "hover:border-fg-subtle focus-visible:outline-none focus-visible:border-fg-subtle",
        )}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate">{selected?.name ?? value ?? ""}</span>
          {selected && selected.name !== selected.id && (
            <Caption as="span" className="truncate text-xs text-fg-muted">
              {selected.id}
            </Caption>
          )}
        </span>
        <CaretDown size={14} className="shrink-0 text-fg-muted" />
      </button>
      {helperText && (
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{helperText}</p>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-72 rounded-md border border-border bg-[var(--ra-main-surface-color)] shadow-lg">
          <div className="border-b border-border p-2">
            <SearchField
              ref={searchRef}
              size="sm"
              label={t("aiConfig.modelPicker.search")}
              placeholder={t("aiConfig.modelPicker.search")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={`${listId}-option-${activeIndex}`}
            />
          </div>
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="max-h-72 overflow-y-auto py-1"
          >
            {freeEntry ? (
              <li
                id={`${listId}-option-0`}
                data-index={0}
                role="option"
                aria-selected={false}
                onClick={() => commit(freeEntry)}
                className={cn(
                  "cursor-pointer px-3 py-2 text-sm",
                  activeIndex === 0 && "bg-fill",
                )}
              >
                {t("aiConfig.modelPicker.useCustom", { id: freeEntry })}
              </li>
            ) : (
              filtered.map((option, index) => (
                <li
                  key={option.id}
                  id={`${listId}-option-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={option.id === value}
                  onClick={() => commit(option.id)}
                  onMouseMove={() => setActiveIndex(index)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5",
                    activeIndex === index && "bg-fill",
                  )}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm text-fg">
                      <span className="truncate">{option.name}</span>
                      {option.id === value && (
                        <Check size={13} className="shrink-0 text-fg-muted" />
                      )}
                      {option.recommended && (
                        <Badge className="shrink-0">{t("aiConfig.modelPicker.recommended")}</Badge>
                      )}
                    </span>
                    {option.name !== option.id && (
                      <span className="block truncate text-xs text-fg-muted">
                        {option.id}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-xs text-fg-muted">
                    {option.cost && <span>{formatCost(option.cost)}</span>}
                  </span>
                </li>
              ))
            )}
            {!freeEntry && filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-fg-muted">
                {t("aiConfig.modelPicker.empty")}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
