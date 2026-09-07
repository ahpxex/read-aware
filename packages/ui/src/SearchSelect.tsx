import type { ReactNode } from "react";
import { FloatingFocusManager, FloatingPortal } from "@floating-ui/react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { cn } from "./lib/cn";
import { SearchField } from "./SearchField";
import { useSearchSelect, type SearchSelectOption } from "./lib/useSearchSelect";

export type SearchSelectProps = {
  label: string;
  value: string;
  options: readonly SearchSelectOption[];
  onChange: (value: string) => void;
  searchLabel: string;
  emptyText: string;
  placeholder?: string;
  customLabel?: (value: string) => string;
  helperText?: string;
  status?: ReactNode;
};

/** Searchable selection in a viewport-constrained portal, including inside scrolling dialogs. */
export function SearchSelect({ label, value, options, onChange, searchLabel, emptyText, placeholder, customLabel, helperText, status }: SearchSelectProps) {
  const picker = useSearchSelect(options, value, onChange, !!customLabel);
  const listId = `${picker.id}-list`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span id={`${picker.id}-label`} className="text-[13px] font-medium text-fg-muted">{label}</span>
      <button
        ref={picker.refs.setReference}
        type="button"
        aria-labelledby={`${picker.id}-label ${picker.id}-value`}
        aria-haspopup="dialog"
        aria-expanded={picker.open}
        aria-controls={picker.open ? `${picker.id}-popup` : undefined}
        aria-describedby={helperText ? `${picker.id}-helper` : undefined}
        className="flex w-full items-center justify-between gap-2 border-b border-border bg-transparent pb-2 text-left text-base text-fg outline-none focus-visible:border-fg"
        {...picker.getReferenceProps()}
      >
        <span id={`${picker.id}-value`} className="min-w-0 truncate">{picker.selected?.label || value || placeholder || label}</span>
        <CaretDown size={16} className="shrink-0 text-fg-muted" />
      </button>
      {helperText && <p id={`${picker.id}-helper`} className="text-[11px] leading-tight text-fg-muted">{helperText}</p>}
      {picker.open && (
        <FloatingPortal>
          <FloatingFocusManager context={picker.context} initialFocus={picker.inputRef} modal={false} returnFocus>
            <div
              ref={picker.refs.setFloating}
              id={`${picker.id}-popup`}
              role="dialog"
              aria-label={label}
              data-ui-portal=""
              style={{ ...picker.floatingStyles, zIndex: 80 }}
              className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-[var(--ra-main-surface-color)] text-fg shadow-lg"
              {...picker.getFloatingProps()}
            >
              <div className="shrink-0 border-b border-border p-2">
                <SearchField
                  ref={picker.inputRef} size="sm" label={searchLabel} placeholder={searchLabel}
                  value={picker.query} onChange={(event) => picker.search(event.target.value)} onKeyDown={picker.onKeyDown}
                  role="combobox" aria-autocomplete="list" aria-expanded aria-controls={listId}
                  aria-activedescendant={picker.rows.length ? `${listId}-${picker.active}` : undefined}
                />
              </div>
              {status && <div className="shrink-0 border-b border-border px-3 py-2">{status}</div>}
              <ul ref={picker.listRef} id={listId} role="listbox" aria-label={label} className="min-h-0 overflow-y-auto overscroll-contain py-1">
                {picker.rows.map((option, index) => (
                  <li key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value}
                    onMouseMove={() => picker.setActiveIndex(index)} onClick={() => picker.choose(option.value)}
                    className={cn("flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm", picker.active === index && "bg-fill")}>
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="block">{option.value === picker.customValue ? customLabel?.(option.value) : option.label}</span>
                      {option.description && <span className="block text-xs text-fg-muted">{option.description}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-fg-muted">
                      {option.detail && <span>{option.detail}</span>}
                      {option.value === value && <Check size={14} aria-hidden="true" />}
                    </span>
                  </li>
                ))}
              </ul>
              {picker.rows.length === 0 && <p role="status" className="px-3 py-3 text-xs text-fg-muted">{emptyText}</p>}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </div>
  );
}
