import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { IconButton } from "./IconButton";
import { cn } from "./lib/cn";

export interface ToastOptions {
  title?: string;
  description: ReactNode;
  variant?: "default" | "destructive" | "success";
  /** Auto-dismiss delay in ms. Pass 0 to keep the toast until closed. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 6000;

// Errors stay in the editorial stone palette — a firmer border and full-value
// title carry the weight; no tinted fills (the house style bans loud panels).
const variantClasses = {
  default: "border-border bg-[var(--ra-main-surface-color)] text-fg-muted",
  destructive:
    "border-border-strong bg-[var(--ra-main-surface-color)] text-fg-muted",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950 dark:text-emerald-100",
} as const;

const titleClasses = {
  default: "text-fg",
  destructive: "text-fg",
  success: "text-emerald-950 dark:text-emerald-100",
} as const;

/**
 * Transient notices, stacked in the top-right corner: auto-dismissed after a
 * few seconds and always manually dismissable. For one-shot events (import
 * results, background failures) that should never park permanently in the
 * page flow — persistent state belongs to Alert.
 */
export function ToastProvider({
  children,
  closeLabel = "Dismiss",
}: {
  children: ReactNode;
  /** Accessible label for each toast's close button (localize at the mount site). */
  closeLabel?: string;
}) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextIdRef.current++;
      setToasts((current) => [...current, { ...options, id }]);
      const duration = options.duration ?? DEFAULT_DURATION_MS;
      if (duration > 0) {
        timersRef.current.set(
          id,
          window.setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          className="pointer-events-none fixed right-4 top-4 z-[80] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
        >
          {toasts.map((entry) => (
            <div
              key={entry.id}
              role="status"
              className={cn(
                "ra-motion-overlay-pop pointer-events-auto flex items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-sm",
                variantClasses[entry.variant ?? "default"],
              )}
            >
              <div className="min-w-0 flex-1">
                {entry.title && (
                  <p className={cn("mb-1 font-medium", titleClasses[entry.variant ?? "default"])}>
                    {entry.title}
                  </p>
                )}
                <div>{entry.description}</div>
              </div>
              <IconButton
                size="sm"
                className="-mr-2 -mt-1.5 shrink-0"
                icon={<X size={14} aria-hidden="true" />}
                label={closeLabel}
                onClick={() => dismiss(entry.id)}
              />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

/** Fire transient notices. Must be called under a ToastProvider. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
