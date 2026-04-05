import { useRef, useEffect, useId, useCallback } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { useLocalAtom } from "../state/local";
import { cn } from "./lib/cn";
import { ScrollArea } from "./ScrollArea";

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
  const listboxRef = useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = useLocalAtom(-1);

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

  // close on outside click / escape
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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
          "font-sans text-eyebrow font-medium uppercase tracking-eyebrow",
          hasError ? "text-red-700" : "text-stone-600",
        )}
      >
        {label}
      </label>

      {/* hidden native input for form submission */}
      {name && <input type="hidden" name={name} value={currentValue} />}

      <div className="relative">
        <button
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
            isPlaceholder ? "text-stone-400" : "text-stone-950",
            disabled && "cursor-not-allowed opacity-50",
            variant === "underline" &&
              cn(
                "border-b pb-2",
                hasError
                  ? "border-red-400 focus:border-red-600"
                  : "border-border focus:border-stone-950",
              ),
            variant === "outlined" &&
              cn(
                "border px-3 py-2",
                hasError
                  ? "border-red-400 focus:border-red-600"
                  : "border-border focus:border-stone-950",
              ),
          )}
        >
          <span className="truncate">{displayText}</span>
          <CaretDown
            size={16}
            weight="bold"
            className={cn(
              "ml-2 shrink-0 text-stone-400 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open && (
          <ScrollArea className="absolute z-50 mt-1 max-h-60 w-full border border-border bg-paper py-1 shadow-sm">
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
                    "cursor-pointer px-3 py-1.5 text-sm",
                    i === activeIndex && "bg-stone-100",
                    opt.value === currentValue
                      ? "font-medium text-stone-950"
                      : "text-stone-700",
                  )}
                >
                  {opt.label}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>

      {hasError && (
        <p id={`${id}-error`} className="text-[11px] leading-tight text-red-700">
          {error}
        </p>
      )}
      {!hasError && helperText && (
        <p id={`${id}-helper`} className="text-[11px] leading-tight text-stone-600">
          {helperText}
        </p>
      )}
    </div>
  );
}
