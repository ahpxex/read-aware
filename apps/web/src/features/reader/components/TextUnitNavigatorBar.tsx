import {
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretLeft,
  CaretRight,
  ChatCircle,
  Crosshair,
  DotsSixVertical,
  ListBullets,
  Notebook,
  SpeakerHigh,
  SpeakerSlash,
  TextAa,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useLocale, useTranslation } from "../../../i18n";
import { hasCoarsePointer } from "../../../platform/environment";
import { resolvePluginText } from "../../plugins/lib/plugin-i18n";
import { renderPluginIcon } from "../../plugins/lib/plugin-icons";
import { resolveReaderModeUnit } from "../../plugins/lib/reader-mode";
import type { RegisteredReaderMode } from "../../plugins/lib/plugin-types";
import type { ReaderPanelKind } from "../state/panel-intent";
import { useDraggableFloat } from "../hooks/useDraggableFloat";

type TextUnitNavigatorBarProps = {
  visible: boolean;
  mode: RegisteredReaderMode;
  /** Coordinate space the bar floats in when dragged (the reader root). */
  containerRef: RefObject<HTMLElement | null>;
  /** Whether the navigator has a resting unit to jump back to. */
  canReturn: boolean;
  /** Whether a page tap steps forward. On touch screens that makes the page
   *  itself the forward affordance, so the bar keeps only the back-step;
   *  with the tap disarmed it carries both step buttons. */
  tapToAdvance: boolean;
  /** Step unit; the bar carries a quick toggle so switching doesn't require
   *  a trip into Settings. */
  unitId: string;
  onUnitChange: (unitId: string) => void;
  /** Direct panel access — while tap-to-advance claims the page tap, these
   *  buttons open TOC / annotations / appearance / chat in one tap (the shell
   *  chrome lights up alongside the requested panel). */
  onOpenPanel: (panel: ReaderPanelKind) => void;
  onPrev: () => void;
  onNext: () => void;
  onReturnToCurrent: () => void;
  onExit: () => void;
  /** Read-aloud (hidden where the webview offers no speech synthesis). */
  readAloudAvailable: boolean;
  readAloudPlaying: boolean;
  onToggleReadAloud: () => void;
};

/** Hairline divider separating action groups within the bar. */
function BarDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

/** Icon-button-with-tooltip — every control in the bar reads the same way. */
function BarButton({
  label,
  disabled,
  pressed,
  onClick,
  icon,
  className,
}: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  icon: ReactNode;
  className: string;
}) {
  return (
    <Tooltip content={label} side="top">
      <IconButton
        label={label}
        size="sm"
        disabled={disabled}
        aria-pressed={pressed}
        onClick={onClick}
        className={cn(className, pressed && "bg-fill-strong text-fg")}
        icon={icon}
      />
    </Tooltip>
  );
}

/**
 * The unit navigator's floating control strip — by default pinned to the
 * bottom center of the reader: step to the previous / next unit, jump back
 * to the resting unit, switch the step unit, read aloud, and exit.
 *
 * Unit-level ACTIONS (copy / highlight / underline / note / ask AI / plugin
 * lookups) no longer live here: tapping the resting unit's wash opens them
 * as an anchored menu right at the sentence — the bar stays a pure
 * navigation strip, short enough to never crowd a phone screen. On
 * coarse-pointer devices it keeps only the back-step while tap-to-advance
 * owns the forward step (a tap anywhere on the page), and it grows a grip
 * that drags it anywhere; the spot sticks per device.
 */
export function TextUnitNavigatorBar({
  visible,
  mode,
  containerRef,
  canReturn,
  tapToAdvance,
  unitId,
  onUnitChange,
  onOpenPanel,
  onPrev,
  onNext,
  onReturnToCurrent,
  onExit,
  readAloudAvailable,
  readAloudPlaying,
  onToggleReadAloud,
}: TextUnitNavigatorBarProps) {
  const { t } = useTranslation("reader");
  const locale = useLocale();
  const coarsePointer = hasCoarsePointer();
  // While a page tap steps forward on touch, a next button would only repeat
  // it — the bar carries the back-step alone. Disarm the tap and it returns.
  const showNextStep = !coarsePointer || !tapToAdvance;
  const float = useDraggableFloat({ containerRef, controlId: "navigator-bar" });
  // 手机宽度装不下整条：触屏分两页（» 翻到面板/退出页，« 翻回导航页），
  // 桌面有空间，永远整条铺开。双箭头图标与单步的 ‹ › 区分。
  const paged = coarsePointer;
  const [page, setPage] = useState<0 | 1>(0);
  useEffect(() => {
    if (!visible) setPage(0);
  }, [visible]);

  if (!visible) return null;

  const activeUnit = resolveReaderModeUnit(mode, unitId);
  const quickUnits = mode.units.filter((unit) => unit.id !== mode.defaultUnitId);
  const prevStepLabel = resolvePluginText(activeUnit.previousLabel, locale);
  const nextStepLabel = resolvePluginText(activeUnit.nextLabel, locale);
  // Quiet, monochrome ghost buttons — same surface language as the selection
  // menu. Touch gets a taller target without widening the desktop bar; width
  // stays at 36px so the full strip still fits a phone screen in one row.
  const actionButtonClass =
    "rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:ring-fg disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-10 pointer-coarse:w-9";

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div
        className={
          float.style
            ? // w-max: an absolutely positioned box otherwise shrinks to the
              // space between `left` and the container edge, wrapping the bar
              // once it's dragged off-center.
              "absolute w-max max-w-full -translate-x-1/2 -translate-y-1/2 px-0"
            : "absolute inset-x-0 bottom-[calc(1.25rem+var(--ra-safe-bottom))] flex justify-center px-4"
        }
        style={float.style ?? undefined}
      >
        <div
          role="toolbar"
          aria-label={resolvePluginText(mode.copy.title, locale)}
          data-ra-float
          className="ra-motion-overlay-pop pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-lg border border-border bg-[var(--ra-main-surface-color)] p-1 shadow-[0_4px_16px_-6px_rgba(28,25,23,0.25)]"
        >
          <span
            aria-hidden="true"
            {...float.handleProps}
            className={cn(
              "hidden h-10 shrink-0 cursor-grab touch-none items-center rounded-md px-0.5 text-fg-subtle pointer-coarse:flex",
              float.dragging && "cursor-grabbing text-fg",
            )}
          >
            <DotsSixVertical size={16} weight="bold" aria-hidden="true" />
          </span>

          {(!paged || page === 0) && (
            <>
              <BarButton
                label={prevStepLabel}
                onClick={onPrev}
                className={actionButtonClass}
                icon={<CaretLeft size={16} weight="regular" aria-hidden="true" />}
              />
              {showNextStep && (
                <BarButton
                  label={nextStepLabel}
                  onClick={onNext}
                  className={actionButtonClass}
                  icon={<CaretRight size={16} weight="regular" aria-hidden="true" />}
                />
              )}
              {readAloudAvailable && (
                <BarButton
                  label={readAloudPlaying ? t("readAloud.stop") : t("readAloud.start")}
                  pressed={readAloudPlaying}
                  onClick={onToggleReadAloud}
                  className={actionButtonClass}
                  icon={
                    readAloudPlaying ? (
                      <SpeakerSlash size={15} weight="regular" aria-hidden="true" />
                    ) : (
                      <SpeakerHigh size={15} weight="regular" aria-hidden="true" />
                    )
                  }
                />
              )}
              <BarDivider />

              <BarButton
                label={resolvePluginText(mode.copy.returnToCurrent, locale)}
                disabled={!canReturn}
                onClick={onReturnToCurrent}
                className={actionButtonClass}
                icon={<Crosshair size={14} weight="regular" aria-hidden="true" />}
              />
              {quickUnits.map((unit) => {
                const pressed = unit.id === activeUnit.id;
                return (
                  <BarButton
                    key={unit.id}
                    label={resolvePluginText(unit.toggleLabel ?? unit.label, locale)}
                    pressed={pressed}
                    onClick={() => onUnitChange(pressed ? mode.defaultUnitId : unit.id)}
                    className={actionButtonClass}
                    icon={renderPluginIcon(unit.icon, 14)}
                  />
                );
              })}
            </>
          )}

          {paged && page === 0 && (
            <>
              <BarDivider />
              <BarButton
                label={resolvePluginText(mode.copy.moreActions, locale)}
                onClick={() => setPage(1)}
                className={actionButtonClass}
                icon={<CaretDoubleRight size={14} weight="regular" aria-hidden="true" />}
              />
            </>
          )}
          {paged && page === 1 && (
            <BarButton
              label={resolvePluginText(mode.copy.collapseActions, locale)}
              onClick={() => setPage(0)}
              className={actionButtonClass}
              icon={<CaretDoubleLeft size={14} weight="regular" aria-hidden="true" />}
            />
          )}

          {(!paged || page === 1) && (
            <>
              <BarDivider />
              <BarButton
                label={t("tableOfContents")}
                onClick={() => onOpenPanel("toc")}
                className={actionButtonClass}
                icon={<ListBullets size={14} weight="regular" aria-hidden="true" />}
              />
              <BarButton
                label={t("notes")}
                onClick={() => onOpenPanel("annotations")}
                className={actionButtonClass}
                icon={<Notebook size={14} weight="regular" aria-hidden="true" />}
              />
              <BarButton
                label={t("readingAppearance")}
                onClick={() => onOpenPanel("appearance")}
                className={actionButtonClass}
                icon={<TextAa size={14} weight="regular" aria-hidden="true" />}
              />
              <BarButton
                label={t("chat")}
                onClick={() => onOpenPanel("chat")}
                className={actionButtonClass}
                icon={<ChatCircle size={14} weight="regular" aria-hidden="true" />}
              />

              <BarDivider />
              <BarButton
                label={resolvePluginText(mode.copy.exit, locale)}
                onClick={onExit}
                className={actionButtonClass}
                icon={<X size={14} weight="regular" aria-hidden="true" />}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
