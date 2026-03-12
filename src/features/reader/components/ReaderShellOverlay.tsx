import { cn } from "../../../components/lib/cn";
import { Body, Caption } from "../../../components";

function ChevronLeft() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3L5 8l5 5" />
    </svg>
  );
}

type ReaderShellOverlayProps = {
  visible: boolean;
  onBack: () => void;
  title?: string;
  subtitle?: string;
  progress?: number;
  currentPosition?: string;
};

export function ReaderShellOverlay({
  visible,
  onBack,
  title,
  subtitle,
  progress,
  currentPosition,
}: ReaderShellOverlayProps) {
  const percent =
    progress != null ? Math.min(100, Math.max(0, progress * 100)) : null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-50 flex flex-col justify-between",
      )}
    >
      {/* Top bar */}
      <div
        className={cn(
          "pointer-events-auto border-b border-stone-200/60 bg-paper/90 px-5 py-3 backdrop-blur-sm transition-all duration-250 ease-out",
          visible
            ? "translate-y-0 opacity-100"
            : "-translate-y-full opacity-0 pointer-events-none",
        )}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-stone-500 transition-colors hover:text-stone-950 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950"
          >
            <ChevronLeft />
            <span className="font-sans text-caption font-medium">Library</span>
          </button>

          {title && (
            <div className="min-w-0 flex-1 text-center">
              <Body
                size="sm"
                className="truncate font-medium text-stone-950"
              >
                {title}
              </Body>
              {subtitle && (
                <Caption className="truncate text-stone-500">
                  {subtitle}
                </Caption>
              )}
            </div>
          )}

          {/* Right spacer to keep title centered */}
          <div className="w-16 shrink-0" />
        </div>
      </div>

      {/* Bottom bar */}
      <div
        className={cn(
          "pointer-events-auto border-t border-stone-200/60 bg-paper/90 px-5 py-3 backdrop-blur-sm transition-all duration-250 ease-out",
          visible
            ? "translate-y-0 opacity-100"
            : "translate-y-full opacity-0 pointer-events-none",
        )}
      >
        <div className="flex items-center gap-4">
          {currentPosition && (
            <Caption className="shrink-0 text-stone-500">
              {currentPosition}
            </Caption>
          )}

          {percent != null && (
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-stone-200">
                <div
                  className="h-full rounded-full bg-stone-400 transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <Caption className="shrink-0 tabular-nums text-stone-500">
                {Math.round(percent)}%
              </Caption>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
