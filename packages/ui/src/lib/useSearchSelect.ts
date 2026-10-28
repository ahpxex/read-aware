import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  autoUpdate,
  flip,
  getOverflowAncestors,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
} from "@floating-ui/react";

export type SearchSelectOption = {
  value: string;
  label: string;
  description?: string;
  detail?: string;
  /** Right-aligned content before the selection check — badges, inline actions. */
  accessory?: ReactNode;
  /**
   * Section this option belongs to. Consecutive filtered rows sharing a
   * `group` render under one heading; options without one stay unlabeled.
   * When no option sets a group, the list renders flat as before.
   */
  group?: string;
};

export function useSearchSelect(
  options: readonly SearchSelectOption[],
  value: string,
  onChange: (value: string) => void,
  allowCustom: boolean,
  /** True (default): the query also matches option values. False: label + description only. */
  matchValue = true,
) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((option) => option.value === value);
  const all = value && !selected ? [{ value, label: value }, ...options] : options;
  const needle = query.trim().toLowerCase();
  const filtered = all.filter((option) => {
    const haystack = matchValue ? `${option.value} ${option.label}` : `${option.label} ${option.description ?? ""}`;
    return haystack.toLowerCase().includes(needle);
  });
  const customValue =
    allowCustom && query.trim() && !all.some((option) => option.value === query.trim()) ? query.trim() : null;
  const rows = customValue ? [...filtered, { value: customValue, label: customValue }] : filtered;
  const active = Math.min(activeIndex, Math.max(0, rows.length - 1));

  const floating = useFloating({
    open,
    onOpenChange: (next) => {
      setOpen(next);
      setQuery("");
      setActiveIndex(0);
    },
    placement: "bottom-start",
    strategy: "fixed",
    whileElementsMounted: (reference, panel, update) => autoUpdate(reference, panel, update, { animationFrame: true }),
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply: ({ rects, availableWidth, availableHeight, elements }) => {
          Object.assign(elements.floating.style, {
            width: `${Math.max(0, Math.min(Math.max(rects.reference.width, 288), availableWidth))}px`,
            maxHeight: `${Math.max(0, Math.min(360, availableHeight))}px`,
          });
        },
      }),
    ],
  });
  const click = useClick(floating.context);
  const dismiss = useDismiss(floating.context, { bubbles: { escapeKey: false } });
  const interactions = useInteractions([click, dismiss]);
  const anchor = floating.elements.domReference;
  useEffect(() => {
    if (!open || !anchor) return;
    // The search field takes focus inside the portal, so the browser never scrolls
    // the trigger above an on-screen keyboard that shrinks the viewport; do it here.
    const keepAnchorInView = () => anchor.scrollIntoView({ block: "nearest", inline: "nearest" });
    // Only scrolling detaches the panel from its trigger. A viewport resize that
    // covers the trigger is answered above instead of closing the picker.
    const closeWhenScrolledAway = () => {
      if (isClippedOut(anchor)) setOpen(false);
    };
    const scrollers = getOverflowAncestors(anchor);
    window.addEventListener("resize", keepAnchorInView);
    for (const scroller of scrollers) scroller.addEventListener("scroll", closeWhenScrolledAway, { passive: true });
    return () => {
      window.removeEventListener("resize", keepAnchorInView);
      for (const scroller of scrollers) scroller.removeEventListener("scroll", closeWhenScrolledAway);
    };
  }, [open, anchor]);
  // scroll active row into view — looked up by id, since grouped rows are no
  // longer the listbox's direct children.
  useEffect(() => {
    if (open) document.getElementById(`${id}-list-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const choose = (next: string) => {
    onChange(next);
    close();
  };
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
    id,
    open,
    query,
    active,
    inputRef,
    listRef,
    selected,
    rows,
    customValue,
    choose,
    close,
    onKeyDown,
    setActiveIndex,
    search: (text: string) => {
      setQuery(text);
      setActiveIndex(0);
    },
    ...floating,
    ...interactions,
  };
}

/** Whether the element lies entirely outside the viewport or a clipping ancestor. */
function isClippedOut(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  let top = 0;
  let left = 0;
  let bottom = window.innerHeight;
  let right = window.innerWidth;
  for (const ancestor of getOverflowAncestors(element)) {
    if (!(ancestor instanceof Element)) continue;
    const clip = ancestor.getBoundingClientRect();
    top = Math.max(top, clip.top + ancestor.clientTop);
    left = Math.max(left, clip.left + ancestor.clientLeft);
    bottom = Math.min(bottom, clip.top + ancestor.clientTop + ancestor.clientHeight);
    right = Math.min(right, clip.left + ancestor.clientLeft + ancestor.clientWidth);
  }
  return rect.bottom <= top || rect.top >= bottom || rect.right <= left || rect.left >= right;
}
