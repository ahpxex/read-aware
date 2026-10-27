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
  /**
   * Content pinned below the list — an action row such as "Import font…".
   * Rendered as a function so the row can close the popup after firing its
   * own action.
   */
  footer?: (close: () => void) => ReactNode;
  /** False: the query matches only label/description — never the stored value. */
  matchValue?: boolean;
};

/** Searchable selection in a viewport-constrained portal, including inside scrolling dialogs. */
export function SearchSelect({
  label,
  value,
  options,
  onChange,
  searchLabel,
  emptyText,
  placeholder,
  customLabel,
  helperText,
  status,
  footer,
  matchValue,
}: SearchSelectProps) {
  const picker = useSearchSelect(options, value, onChange, !!customLabel, matchValue);
  const listId = `${picker.id}-list`;

  const renderRow = (option: SearchSelectOption, index: number) => (
    <li
      key={option.value}
      id={`${listId}-${index}`}
      role="option"
      aria-selected={option.value === value}
      onMouseMove={() => picker.setActiveIndex(index)}
      onClick={() => picker.choose(option.value)}
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm",
        picker.active === index && "bg-fill",
      )}
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="block">
          {option.value === picker.customValue ? customLabel?.(option.value) : option.label}
        </span>
        {option.description && <span className="block text-xs text-fg-muted">{option.description}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-fg-muted">
        {option.detail && <span>{option.detail}</span>}
        {option.accessory}
        {option.value === value && <Check size={14} aria-hidden="true" />}
      </span>
    </li>
  );

  // Consecutive filtered rows sharing a `group` collapse into one section —
  // a group whose rows all filtered out disappears entirely. Sections only
  // exist once at least one row names a group; a fully ungrouped list keeps
  // the flat DOM it always had.
  const sections: { label?: string; headingId?: string; items: { option: SearchSelectOption; index: number }[] }[] = [];
  if (picker.rows.some((option) => option.group !== undefined)) {
    for (const [index, option] of picker.rows.entries()) {
      const last = sections[sections.length - 1];
      if (last && last.label === option.group) {
        last.items.push({ option, index });
      } else {
        sections.push({
          label: option.group,
          headingId: option.group !== undefined ? `${listId}-group-${sections.length}` : undefined,
          items: [{ option, index }],
        });
      }
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span id={`${picker.id}-label`} className="text-[13px] font-medium text-fg-muted">
        {label}
      </span>
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
        <span id={`${picker.id}-value`} className="min-w-0 truncate">
          {picker.selected?.label || value || placeholder || label}
        </span>
        <CaretDown size={16} className="shrink-0 text-fg-muted" />
      </button>
      {helperText && (
        <p id={`${picker.id}-helper`} className="text-[11px] leading-tight text-fg-muted">
          {helperText}
        </p>
      )}
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
              <div className="shrink-0 border-b border-border px-3 py-2">
                <SearchField
                  ref={picker.inputRef}
                  size="sm"
                  variant="plain"
                  label={searchLabel}
                  placeholder={searchLabel}
                  value={picker.query}
                  onChange={(event) => picker.search(event.target.value)}
                  onKeyDown={picker.onKeyDown}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded
                  aria-controls={listId}
                  aria-activedescendant={picker.rows.length ? `${listId}-${picker.active}` : undefined}
                />
              </div>
              {status && <div className="shrink-0 border-b border-border px-3 py-2">{status}</div>}
              <ul
                ref={picker.listRef}
                id={listId}
                role="listbox"
                aria-label={label}
                className="min-h-0 overflow-y-auto overscroll-contain py-1"
              >
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
                            className="px-3 pb-1 pt-2 text-[11px] text-fg-subtle"
                          >
                            {section.label}
                          </div>
                        )}
                        <ul role="none">{section.items.map(({ option, index }) => renderRow(option, index))}</ul>
                      </li>
                    ))
                  : picker.rows.map((option, index) => renderRow(option, index))}
              </ul>
              {picker.rows.length === 0 && (
                <p role="status" className="px-3 py-3 text-xs text-fg-muted">
                  {emptyText}
                </p>
              )}
              {footer && <div className="shrink-0 border-t border-border p-1">{footer(picker.close)}</div>}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </div>
  );
}
