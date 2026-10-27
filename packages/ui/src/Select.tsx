import { useRef, useEffect, useLayoutEffect, useId, useCallback } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CaretDown } from "@phosphor-icons/react";
import { useLocalAtom } from "./lib/useLocalAtom";
import { cn } from "./lib/cn";
import { ScrollArea } from "./ScrollArea";

/** Viewport-fixed coordinates for the portaled listbox. */
type MenuPosition = {
  /** Preserve scoped typography when rendering under document.body. */
  fontFamily: string;
  left: number;
  width: number;
  maxHeight: number;
  placeBelow: boolean;
  /**
   * Distance from the viewport edge the menu grows away from: `top` when
   * placed below the trigger, `bottom` when placed above. Anchoring the
   * near edge keeps the menu hugging the trigger whatever its content height.
   */
  offset: number;
};

type SelectOption = {
  label: string;
  value: string;
  /** Right-aligned content inside the option — badges, hints, inline actions. */
  accessory?: ReactNode;
  /**
   * Section this option belongs to. Consecutive options sharing a `group`
   * render under one heading in the listbox; options without one stay
   * unlabeled. When no option sets a group, the list renders flat as before.
   */
  group?: string;
};

type SelectProps = {
  /**
   * Visible label. Omit ONLY inside a composite control that labels the group
   * itself (see TimeField) — then pass `ariaLabel` so the combobox still has
   * an accessible name.
   */
  label?: string;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  helperText?: string;
  error?: string;
  placeholder?: string;
  variant?: "underline" | "outlined";
  disabled?: boolean;
  name?: string;
  className?: string;
  /**
   * Content pinned above the option list — an action row such as
   * "Import font…". Rendered as a function so the row can close the popup
   * after firing its own action.
   */
  popupHeader?: (close: () => void) => ReactNode;
  /** Same as `popupHeader`, pinned below the scrollable option list. */
  popupFooter?: (close: () => void) => ReactNode;
};

export function Select({
  label,
  ariaLabel,
  options,
  value: controlledValue,
  defaultValue,
  onChange,
  helperText,
  error,
  placeholder,
  variant = "underline",
  disabled,
  name,
  className,
  popupHeader,
  popupFooter,
}: SelectProps) {
  const id = useId();
  const hasError = !!error;
  const [open, setOpen] = useLocalAtom(false);
  const [internalValue, setInternalValue] = useLocalAtom(defaultValue ?? "");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = useLocalAtom(-1);
  const [position, setPosition] = useLocalAtom<MenuPosition | null>(null);

  const currentValue = controlledValue !== undefined ? controlledValue : internalValue;
  const selectedOption = options.find((o) => o.value === currentValue);
  const displayText = selectedOption?.label ?? placeholder ?? "";
  const isPlaceholder = !selectedOption;

  const select = useCallback(
    (val: string) => {
      if (controlledValue === undefined) setInternalValue(val);
      onChange?.(val);
      setOpen(false);
    },
    [controlledValue, onChange, setInternalValue, setOpen],
  );

  // close on outside click / escape — the listbox is portaled to <body>, so it
  // is outside `containerRef`; treat `popupRef` as "inside" too or an option
  // click would dismiss before it registers.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  // Anchor the portaled listbox to the trigger with fixed coordinates, so it
  // floats above any scroll container (e.g. a settings dialog) instead of
  // extending its scroll area and shoving the layout. Flips above the trigger
  // when there is more room there. Recomputed on scroll/resize while open;
  // useLayoutEffect positions it before paint to avoid a flash.
  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const gap = 6;
    const menuCap = 240;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    // Prefer below; flip above only when a full-height menu can't fit below
    // AND above actually offers more room.
    const placeBelow = spaceBelow >= menuCap || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(96, Math.min(menuCap, placeBelow ? spaceBelow : spaceAbove));
    const offset = placeBelow ? rect.bottom + gap : window.innerHeight - rect.top + gap;
    setPosition({
      left: rect.left,
      width: rect.width,
      maxHeight,
      placeBelow,
      offset,
      fontFamily: getComputedStyle(button).fontFamily,
    });
  }, [setPosition]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const reposition = () => updatePosition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, updatePosition]);

  // scroll active option into view — looked up by id, since grouped options
  // are no longer the listbox's direct children.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const item = document.getElementById(`${id}-option-${activeIndex}`);
    item?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, id]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (open && activeIndex >= 0) {
          select(options[activeIndex].value);
        } else {
          setOpen(true);
          setActiveIndex(options.findIndex((o) => o.value === currentValue));
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIndex(options.findIndex((o) => o.value === currentValue));
        } else {
          setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (open) {
          setActiveIndex((i) => Math.max(i - 1, 0));
        }
        break;
    }
  }

  const activeDescendant = open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;

  const renderOption = (opt: SelectOption, i: number) => (
    <li
      key={opt.value}
      id={`${id}-option-${i}`}
      role="option"
      aria-selected={opt.value === currentValue}
      onMouseEnter={() => setActiveIndex(i)}
      onClick={() => select(opt.value)}
      className={cn(
        "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        i === activeIndex && "bg-fill",
        opt.value === currentValue ? "font-medium text-fg" : "text-fg-muted",
      )}
    >
      <span className="truncate">{opt.label}</span>
      {opt.accessory}
    </li>
  );

  // Consecutive options sharing a `group` collapse into one section. Sections
  // only exist once at least one option names a group — a fully ungrouped
  // list keeps the flat DOM it always had.
  const sections: { label?: string; headingId?: string; items: { option: SelectOption; index: number }[] }[] = [];
  if (options.some((option) => option.group !== undefined)) {
    for (const [index, option] of options.entries()) {
      const last = sections[sections.length - 1];
      if (last && last.label === option.group) {
        last.items.push({ option, index });
      } else {
        sections.push({
          label: option.group,
          headingId: option.group !== undefined ? `${id}-group-${sections.length}` : undefined,
          items: [{ option, index }],
        });
      }
    }
  }

  return (
    <div ref={containerRef} className={cn("flex flex-col gap-1.5", className)}>
      {label !== undefined && (
        <label
          id={`${id}-label`}
          className={cn(
            "font-sans text-[13px] font-medium",
            hasError ? "text-red-700 dark:text-red-400" : "text-fg-muted",
          )}
        >
          {label}
        </label>
      )}

      {/* hidden native input for form submission */}
      {name && <input type="hidden" name={name} value={currentValue} />}

      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          role="combobox"
          id={id}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={`${id}-listbox`}
          aria-labelledby={label !== undefined ? `${id}-label` : undefined}
          aria-label={label === undefined ? ariaLabel : undefined}
          aria-activedescendant={activeDescendant}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? `${id}-error` : helperText ? `${id}-helper` : undefined}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            if (!open) setActiveIndex(options.findIndex((option) => option.value === currentValue));
            setOpen((value) => !value);
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex w-full items-center justify-between bg-transparent text-left font-sans text-base outline-none",
            isPlaceholder ? "text-fg-subtle" : "text-fg",
            disabled && "cursor-not-allowed opacity-50",
            variant === "underline" &&
              cn("border-b pb-2", hasError ? "border-red-400 focus:border-red-600" : "border-border focus:border-fg"),
            variant === "outlined" &&
              cn(
                "border px-3 py-2",
                hasError ? "border-red-400 focus:border-red-600" : "border-border focus:border-fg",
              ),
          )}
        >
          <span className="truncate">{displayText}</span>
          <CaretDown
            size={16}
            weight="bold"
            className={cn("ml-2 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")}
          />
        </button>

        {open &&
          position &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={popupRef}
              // Marks body-portaled floating UI: ancestor popovers/menus must
              // not treat clicks in here as "outside" (see Popover/DropdownMenu).
              data-ui-portal=""
              style={{
                position: "fixed",
                fontFamily: position.fontFamily,
                ...(position.placeBelow ? { top: position.offset } : { bottom: position.offset }),
                left: position.left,
                width: position.width,
                zIndex: 80,
              }}
              className={cn("ra-motion-overlay-pop", position.placeBelow ? "origin-top" : "origin-bottom")}
            >
              <div className="w-full rounded-md border border-border bg-[var(--ra-main-surface-color)] p-1">
                {popupHeader?.(() => setOpen(false))}
                <ScrollArea style={{ maxHeight: position.maxHeight }} className="w-full">
                  <ul ref={listboxRef} id={`${id}-listbox`} role="listbox" aria-labelledby={`${id}-label`}>
                    {sections.length > 0
                      ? sections.map((section, sectionIndex) => (
                          <li
                            key={section.headingId ?? `section-${sectionIndex}`}
                            role="group"
                            aria-labelledby={section.headingId}
                            className={cn(sectionIndex > 0 && "mt-1 border-t border-border pt-1")}
                          >
                            {section.headingId && (
                              <div
                                id={section.headingId}
                                role="presentation"
                                className="px-2.5 pb-1 pt-2 text-[11px] text-fg-subtle"
                              >
                                {section.label}
                              </div>
                            )}
                            <ul role="none">{section.items.map(({ option, index }) => renderOption(option, index))}</ul>
                          </li>
                        ))
                      : options.map((option, index) => renderOption(option, index))}
                  </ul>
                </ScrollArea>
                {popupFooter?.(() => setOpen(false))}
              </div>
            </div>,
            document.body,
          )}
      </div>

      {hasError && (
        <p id={`${id}-error`} className="text-[11px] leading-tight text-red-700">
          {error}
        </p>
      )}
      {!hasError && helperText && (
        <p id={`${id}-helper`} className="text-[11px] leading-tight text-fg-muted">
          {helperText}
        </p>
      )}
    </div>
  );
}
