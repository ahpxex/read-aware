import { Select } from "./Select";
import { cn } from "./lib/cn";

/**
 * A time of day, picked rather than typed.
 *
 * Two dropdowns (hours, minutes) over one `HH:MM` value. A text input for a
 * time is a small trap — locale ambiguity, half-typed states, "7pm" — and a
 * native `<input type="time">` renders as whatever the platform feels like,
 * which is never the rest of this design system. Two Selects are unambiguous,
 * keyboard-navigable, and look like every other control here.
 *
 * The value is always the 24-hour `HH:MM` string; what a locale calls that
 * hour is a display question this control deliberately does not have (yet).
 */
type TimeFieldProps = {
  label: string;
  /** `HH:MM`, 24-hour. An unparseable value shows as unset. */
  value?: string;
  onChange?: (value: string) => void;
  helperText?: string;
  error?: string;
  /** Minute granularity offered in the second dropdown. Defaults to 5. */
  minuteStep?: number;
  /** Accessible names for the two dropdowns — pass localized copy. */
  hoursLabel?: string;
  minutesLabel?: string;
  disabled?: boolean;
  className?: string;
};

const pad = (value: number | string) => String(value).padStart(2, "0");

/** `HH:MM` → its two parts; nulls when the value is not a time. */
export function splitTimeValue(value: string | undefined): {
  hours: string;
  minutes: string;
} {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec((value ?? "").trim());
  if (!match) return { hours: "", minutes: "" };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return { hours: "", minutes: "" };
  return { hours: pad(hours), minutes: pad(minutes) };
}

export function TimeField({
  label,
  value,
  onChange,
  helperText,
  error,
  minuteStep = 5,
  hoursLabel = "Hours",
  minutesLabel = "Minutes",
  disabled,
  className,
}: TimeFieldProps) {
  const { hours, minutes } = splitTimeValue(value);
  const hasError = !!error;

  const hourOptions = Array.from({ length: 24 }, (_, hour) => ({
    value: pad(hour),
    label: pad(hour),
  }));
  const step = Math.min(Math.max(Math.trunc(minuteStep) || 5, 1), 30);
  const minuteOptions = Array.from({ length: Math.ceil(60 / step) }, (_, index) => ({
    value: pad(index * step),
    label: pad(index * step),
  }));
  // A stored minute off the step grid (an older value, another device's
  // setting) stays selectable instead of reading as unset.
  if (minutes && !minuteOptions.some((option) => option.value === minutes)) {
    minuteOptions.push({ value: minutes, label: minutes });
    minuteOptions.sort((left, right) => Number(left.value) - Number(right.value));
  }

  // Half a time is not a time: completing the other half from zero keeps
  // every emitted value valid, whatever order the two are touched in.
  const emit = (nextHours: string, nextMinutes: string) =>
    onChange?.(`${nextHours || "00"}:${nextMinutes || "00"}`);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span
        className={cn(
          "font-sans text-[13px] font-medium",
          hasError ? "text-red-700 dark:text-red-400" : "text-fg-muted",
        )}
      >
        {label}
      </span>
      <div className="flex items-center gap-2">
        <Select
          ariaLabel={`${label} — ${hoursLabel}`}
          variant="outlined"
          options={hourOptions}
          value={hours}
          placeholder="--"
          disabled={disabled}
          className="w-24"
          onChange={(next) => emit(next, minutes)}
        />
        <span aria-hidden className="font-sans text-base text-fg-subtle">
          :
        </span>
        <Select
          ariaLabel={`${label} — ${minutesLabel}`}
          variant="outlined"
          options={minuteOptions}
          value={minutes}
          placeholder="--"
          disabled={disabled}
          className="w-24"
          onChange={(next) => emit(hours, next)}
        />
      </div>
      {hasError && (
        <p className="text-[11px] leading-tight text-red-700">{error}</p>
      )}
      {!hasError && helperText && (
        <p className="text-[11px] leading-tight text-fg-muted">{helperText}</p>
      )}
    </div>
  );
}
