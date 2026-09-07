import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { autoUpdate, flip, hide, offset, shift, size, useClick, useDismiss, useFloating, useInteractions } from "@floating-ui/react";

export type SearchSelectOption = { value: string; label: string; description?: string; detail?: string };

export function useSearchSelect(options: readonly SearchSelectOption[], value: string, onChange: (value: string) => void, allowCustom: boolean) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((option) => option.value === value);
  const all = value && !selected ? [{ value, label: value }, ...options] : options;
  const needle = query.trim().toLowerCase();
  const filtered = all.filter((option) => `${option.value} ${option.label}`.toLowerCase().includes(needle));
  const customValue = allowCustom && query.trim() && !all.some((option) => option.value === query.trim()) ? query.trim() : null;
  const rows = customValue ? [...filtered, { value: customValue, label: customValue }] : filtered;
  const active = Math.min(activeIndex, Math.max(0, rows.length - 1));

  const floating = useFloating({
    open,
    onOpenChange: (next) => { setOpen(next); setQuery(""); setActiveIndex(0); },
    placement: "bottom-start",
    strategy: "fixed",
    whileElementsMounted: (reference, panel, update) => autoUpdate(reference, panel, update, { animationFrame: true }),
    middleware: [
      offset(6), flip({ padding: 8 }), shift({ padding: 8 }),
      size({ padding: 8, apply: ({ rects, availableWidth, availableHeight, elements }) => {
        Object.assign(elements.floating.style, {
          width: `${Math.max(0, Math.min(Math.max(rects.reference.width, 288), availableWidth))}px`,
          maxHeight: `${Math.max(0, Math.min(360, availableHeight))}px`,
        });
      } }),
      hide({ strategy: "referenceHidden" }),
    ],
  });
  const click = useClick(floating.context);
  const dismiss = useDismiss(floating.context, { bubbles: { escapeKey: false } });
  const interactions = useInteractions([click, dismiss]);
  useEffect(() => {
    if (open && floating.middlewareData.hide?.referenceHidden) setOpen(false);
  }, [open, floating.middlewareData.hide?.referenceHidden]);
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const choose = (next: string) => { onChange(next); setOpen(false); setQuery(""); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(0, Math.min(rows.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" && rows[active]) {
      event.preventDefault();
      choose(rows[active].value);
    }
  };
  return {
    id, open, query, active, inputRef, listRef, selected, rows, customValue, choose, onKeyDown,
    setActiveIndex,
    search: (text: string) => { setQuery(text); setActiveIndex(0); },
    ...floating, ...interactions,
  };
}
