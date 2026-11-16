import type { ReactNode } from "react";
import { Eraser, Highlighter, TextUnderline } from "@phosphor-icons/react";
import { IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import type { Highlight } from "../../annotations";
import { HIGHLIGHT_COLORS } from "../lib/highlight-renderer";

type MarkStyle = NonNullable<Highlight["style"]>;
const COLORS: Highlight["color"][] = ["yellow", "green", "blue", "pink"];

type ReaderPassageMarksProps = {
  /** The passage's mark, if it has one. */
  mark: Highlight | null;
  /** The color a new mark takes when only a style is chosen. */
  defaultColor: Highlight["color"];
  onMark: (style: MarkStyle, color: Highlight["color"]) => void;
  onRemove: () => void;
  className?: string;
};

/**
 * The passage's mark, set from its note card: highlight or underline, and
 * its color. Choosing either marks an unmarked passage; with a mark, they
 * restyle or recolor it, and the eraser removes it (the notes stay).
 */
export function ReaderPassageMarks({ mark, defaultColor, onMark, onRemove, className }: ReaderPassageMarksProps) {
  const { t } = useTranslation("reader");
  const style: MarkStyle | null = mark ? (mark.style ?? "highlight") : null;
  const color = mark?.color ?? defaultColor;
  const styleButton = (value: MarkStyle, label: string, icon: ReactNode) => (
    <IconButton
      size="sm"
      label={label}
      aria-pressed={style === value}
      onClick={() => onMark(value, color)}
      className={cn(style === value ? "bg-fg/10 text-fg" : "text-fg-muted hover:text-fg")}
      icon={icon}
    />
  );

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {styleButton("highlight", t("menu.highlight"), <Highlighter size={15} aria-hidden="true" />)}
      {styleButton("underline", t("menu.underline"), <TextUnderline size={15} aria-hidden="true" />)}
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
      {COLORS.map((value) => (
        <Tooltip key={value} content={t(`colors.${value}`)} side="top">
          {/* oxlint-disable-next-line react/forbid-elements -- a color swatch in the note card's mark row, as in the mark menu */}
          <button
            type="button"
            aria-label={t("recolor", { color: t(`colors.${value}`) })}
            aria-pressed={!!mark && value === mark.color}
            onClick={() => onMark(style ?? "highlight", value)}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
          >
            <span
              className={cn(
                "block h-3.5 w-3.5 rounded-full ring-1 ring-inset",
                mark && value === mark.color ? "ring-fg" : "ring-black/15 dark:ring-white/20",
              )}
              style={{ backgroundColor: HIGHLIGHT_COLORS[value] }}
            />
          </button>
        </Tooltip>
      ))}
      {mark && (
        <IconButton
          size="sm"
          label={t("menu.removeMark")}
          onClick={onRemove}
          className="ml-auto text-fg-muted hover:text-fg"
          icon={<Eraser size={15} aria-hidden="true" />}
        />
      )}
    </div>
  );
}
