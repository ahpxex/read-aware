/**
 * The quiet inline search field shared by the plugin lists (installed +
 * marketplace). A hand-rolled input: the design system has no label-less
 * search primitive, and a floating-label TextField is the wrong voice here.
 */
import { MagnifyingGlass } from "@phosphor-icons/react";

type PluginSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
};

export function PluginSearchInput({
  value,
  onChange,
  placeholder,
  className,
}: PluginSearchInputProps) {
  return (
    <label
      className={`flex items-center gap-2 rounded-md border border-border bg-[var(--ra-main-surface-color)] px-2.5 py-1.5 transition-colors focus-within:border-fg-subtle ${className ?? ""}`}
    >
      <MagnifyingGlass size={14} className="shrink-0 text-fg-subtle" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full bg-transparent font-sans text-sm text-fg outline-none placeholder:text-fg-subtle"
      />
    </label>
  );
}
