import { useRef, useEffect, useLayoutEffect, useId, useCallback } from "react";
import { createPortal } from "react-dom";
import { CaretDown } from "@phosphor-icons/react";
import { useLocalAtom } from "./lib/useLocalAtom";
import { cn } from "./lib/cn";
import { ScrollArea } from "./ScrollArea";

/** Viewport-fixed coordinates for the portaled listbox. */
type MenuPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placeBelow: boolean;
};

type SelectOption = { label: string; value: string };

type SelectProps = {
  label: string;
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
};

export function Select({
  label,
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
    [controlledValue, onChange],
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
  }, [open]);

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
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const placeBelow = spaceBelow >= spaceAbove;
    const maxHeight = Math.max(96, Math.min(240, placeBelow ? spaceBelow : spaceAbove));
    const top = placeBelow ? rect.bottom + gap : Math.max(gap, rect.top - gap - maxHeight);
    setPosition({ top, left: rect.left, width: rect.width, maxHeight, placeBelow });
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

  // scroll active option into view
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const item = listboxRef.current?.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

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

  const activeDescendant =
    open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;

  return (
    <div ref={containerRef} className={cn("flex flex-col gap-1.5", className)}>
      <label
        id={`${id}-label`}
        className={cn(
          "font-sans text-[13px] font-medium",
          hasError ? "text-red-700 dark:text-red-400" : "text-fg-muted",
        )}
      >
        {label}
      </label>

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
          aria-labelledby={`${id}-label`}
          aria-activedescendant={activeDescendant}
          aria-invalid={hasError || undefined}
          aria-describedby={
            hasError ? `${id}-error` : helperText ? `${id}-helper` : undefined
          }
          disabled={disabled}
          onClick={() => !disabled && setOpen((o) => !o)}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex w-full items-center justify-between bg-transparent text-left font-sans text-base outline-none",
            isPlaceholder ? "text-fg-subtle" : "text-fg",
            disabled && "cursor-not-allowed opacity-50",
            variant === "underline" &&
              cn(
                "border-b pb-2",
                hasError
                  ? "border-red-400 focus:border-red-600"
                  : "border-border focus:border-fg",
              ),
            variant === "outlined" &&
              cn(
                "border px-3 py-2",
                hasError
                  ? "border-red-400 focus:border-red-600"
                  : "border-border focus:border-fg",
              ),
          )}
        >
          <span className="truncate">{displayText}</span>
          <CaretDown
            size={16}
            weight="bold"
            className={cn(
              "ml-2 shrink-0 text-fg-subtle transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open &&
          position &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={popupRef}
              style={{
                position: "fixed",
                top: position.top,
                left: position.left,
                width: position.width,
                zIndex: 80,
              }}
              className={cn(
                "ra-motion-overlay-pop",
                position.placeBelow ? "origin-top" : "origin-bottom",
              )}
            >
              <ScrollArea
                style={{ maxHeight: position.maxHeight }}
                className="w-full rounded-md border border-border bg-[var(--ra-main-surface-color)] p-1"
              >
                <ul
                  ref={listboxRef}
                  id={`${id}-listbox`}
                  role="listbox"
                  aria-labelledby={`${id}-label`}
                >
                  {options.map((opt, i) => (
                    <li
                      key={opt.value}
                      id={`${id}-option-${i}`}
                      role="option"
                      aria-selected={opt.value === currentValue}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => select(opt.value)}
                      className={cn(
                        "cursor-pointer rounded-md px-2.5 py-1.5 text-sm transition-colors",
                        i === activeIndex && "bg-fill",
                        opt.value === currentValue
                          ? "font-medium text-fg"
                          : "text-fg-muted",
                      )}
                    >
                      {opt.label}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
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
