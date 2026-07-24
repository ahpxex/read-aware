import {
  BookOpen,
  CaretLeft,
  CaretRight,
  ChatCircleDots,
  Check,
  Copy,
  Crosshair,
  DotsSixVertical,
  DotsThree,
  Highlighter,
  Layout,
  NotePencil,
  TextUnderline,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useLocale, useTranslation } from "../../../i18n";
import { hasCoarsePointer } from "../../../platform/environment";
import { useAskAiEnabled } from "../../ai/hooks/useAskAiEnabled";
import { PluginSelectionCluster } from "../../plugins/components/PluginSelectionCluster";
import { resolvePluginText } from "../../plugins/lib/plugin-i18n";
import { renderPluginIcon } from "../../plugins/lib/plugin-icons";
import { resolveReaderModeUnit } from "../../plugins/lib/reader-mode";
import type {
  RegisteredReaderMode,
  SelectionActionInput,
} from "../../plugins/lib/plugin-types";
import { useDraggableFloat } from "../hooks/useDraggableFloat";

// Collapsing is a touch-only affordance — desktop has room for the full strip
// and always shows it. The choice lives for the session only (module scope so
// it survives the bar remounting between books); a restart returns to the
// collapsed default rather than writing UI minutiae into storage.
let expandedCache: boolean | null = null;

type TextUnitNavigatorBarProps = {
  visible: boolean;
  mode: RegisteredReaderMode;
  /** Identity of the unit the bar acts on; null while none is resting. */
  targetKey: string | null;
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
  /** Re-open the reader shell — while tap-to-advance claims the page tap,
   *  this button is the way back to the chrome. */
  onToggleToolbars: () => void;
  onPrev: () => void;
  onNext: () => void;
  onReturnToCurrent: () => void;
  onCopy: () => Promise<void> | void;
  onHighlight: () => void;
  onUnderline: () => void;
  onAddNote: () => void;
  onLookUp: () => void;
  onAskAI: () => void;
  onExit: () => void;
  /** Resting-unit context for plugin-contributed actions (null hides them). */
  pluginInput?: SelectionActionInput | null;
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
 * to the resting unit, switch the step unit, plus the selection menu's
 * actions applied to the unit the wash is resting on. The action cluster
 * collapses behind a "more" toggle (collapsed by default on touch screens,
 * where the full strip crowds the page); the choice sticks per device. On
 * coarse-pointer devices the bar keeps only the back-step while tap-to-advance
 * owns the forward step (a tap anywhere on the page), and it grows a grip that
 * drags it anywhere; the spot sticks per device.
 */
export function TextUnitNavigatorBar({
  visible,
  mode,
  targetKey,
  containerRef,
  canReturn,
  tapToAdvance,
  unitId,
  onUnitChange,
  onToggleToolbars,
  onPrev,
  onNext,
  onReturnToCurrent,
  onCopy,
  onHighlight,
  onUnderline,
  onAddNote,
  onLookUp,
  onAskAI,
  onExit,
  pluginInput = null,
}: TextUnitNavigatorBarProps) {
  const { t } = useTranslation("reader");
  const locale = useLocale();
  const askEnabled = useAskAiEnabled();
  const copyResetTimeoutRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const coarsePointer = hasCoarsePointer();
  const collapsible = coarsePointer;
  // While a page tap steps forward on touch, a next button would only repeat
  // it — the bar carries the back-step alone. Disarm the tap and it returns.
  const showNextStep = !coarsePointer || !tapToAdvance;
  const [expanded, setExpanded] = useState(() =>
    collapsible ? expandedCache ?? false : true,
  );
  const float = useDraggableFloat({ containerRef, controlId: "navigator-bar" });

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current != null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  // Moving to another unit resets the copy feedback.
  useEffect(() => {
    setCopied(false);
    if (copyResetTimeoutRef.current != null) {
      window.clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = null;
    }
  }, [targetKey]);

  if (!visible) return null;

  async function handleCopy() {
    await onCopy();
    setCopied(true);
    if (copyResetTimeoutRef.current != null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
      copyResetTimeoutRef.current = null;
    }, 1200);
  }

  function toggleExpanded() {
    setExpanded((value) => {
      expandedCache = !value;
      return !value;
    });
  }

  const hasTarget = targetKey != null;
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

          {expanded && (
            <>
              <BarDivider />
              <BarButton
                label={copied ? t("menu.copied") : t("menu.copy")}
                disabled={!hasTarget}
                pressed={copied}
                onClick={() => {
                  void handleCopy();
                }}
                className={actionButtonClass}
                icon={
                  copied ? (
                    <Check size={14} weight="regular" aria-hidden="true" />
                  ) : (
                    <Copy size={14} weight="regular" aria-hidden="true" />
                  )
                }
              />
              <BarButton
                label={t("menu.highlight")}
                disabled={!hasTarget}
                onClick={onHighlight}
                className={actionButtonClass}
                icon={<Highlighter size={14} weight="regular" aria-hidden="true" />}
              />
              <BarButton
                label={t("menu.underline")}
                disabled={!hasTarget}
                onClick={onUnderline}
                className={actionButtonClass}
                icon={<TextUnderline size={14} weight="regular" aria-hidden="true" />}
              />
              <BarButton
                label={t("menu.addNote")}
                disabled={!hasTarget}
                onClick={onAddNote}
                className={actionButtonClass}
                icon={<NotePencil size={14} weight="regular" aria-hidden="true" />}
              />

              <BarDivider />
              <BarButton
                label={t("menu.lookUp")}
                disabled={!hasTarget}
                onClick={onLookUp}
                className={actionButtonClass}
                icon={<BookOpen size={14} weight="regular" aria-hidden="true" />}
              />
              {askEnabled && (
                <BarButton
                  label={t("menu.askAi")}
                  disabled={!hasTarget}
                  onClick={onAskAI}
                  className={actionButtonClass}
                  icon={<ChatCircleDots size={14} weight="regular" aria-hidden="true" />}
                />
              )}
              <PluginSelectionCluster
                input={hasTarget ? pluginInput : null}
                divider={<BarDivider />}
                overflowSide="top"
              />
            </>
          )}

          <BarDivider />
          {collapsible && (
            <IconButton
              label={resolvePluginText(
                expanded ? mode.copy.collapseActions : mode.copy.moreActions,
                locale,
              )}
              size="sm"
              aria-expanded={expanded}
              onClick={toggleExpanded}
              className={cn(actionButtonClass, expanded && "bg-fill-strong text-fg")}
              icon={<DotsThree size={16} weight="bold" aria-hidden="true" />}
            />
          )}
          <BarButton
            label={resolvePluginText(mode.copy.showToolbars, locale)}
            onClick={onToggleToolbars}
            className={actionButtonClass}
            icon={<Layout size={14} weight="regular" aria-hidden="true" />}
          />

          <BarDivider />
          <BarButton
            label={resolvePluginText(mode.copy.exit, locale)}
            onClick={onExit}
            className={actionButtonClass}
            icon={<X size={14} weight="regular" aria-hidden="true" />}
          />
        </div>
      </div>
    </div>
  );
}
