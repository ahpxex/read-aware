/** The design-system search field shared by installed and marketplace lists. */
import { SearchField } from "@read-aware/ui";

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
    <SearchField
      label={placeholder}
      size="sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={className}
    />
  );
}
