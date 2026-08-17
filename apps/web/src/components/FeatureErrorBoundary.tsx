/**
 * Per-surface React error boundary. The root route has a boundary of last
 * resort, but before this existed ANY render error — a reader edge case, a
 * plugin page, a chart — took the whole window down with it. Each major
 * surface (reader, context, stats, plugin pages) mounts inside one of these:
 * the crash is logged to the file log, the rest of the app keeps running, and
 * the surface offers a local retry.
 *
 * A class component because error boundaries still require one; the exported
 * wrapper stays a function component so translations come from the hook.
 */
import { Component, type ReactNode } from "react";
import { Button } from "@read-aware/ui";
import { useTranslation } from "../i18n";
import { createLogger } from "../platform/logger";

const log = createLogger("error-boundary");

type FallbackStrings = {
  title: string;
  body: string;
  retry: string;
};

type BoundaryProps = {
  /** Which surface crashed — the log line and nothing else. */
  surface: string;
  /**
   * Clears a shown error when it changes (e.g. the book id, the active nav
   * key) — navigating to different content must not replay a stale crash.
   */
  resetKey?: unknown;
  strings: FallbackStrings;
  children: ReactNode;
};

type BoundaryState = {
  error: Error | null;
};

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    log.error(`render crash in ${this.props.surface} surface`, error, info.componentStack ?? "");
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const { strings } = this.props;
    return (
      <div className="flex h-full min-h-64 w-full items-center justify-center bg-paper px-6 py-12 text-center">
        <div className="max-w-md space-y-3">
          <h2 className="font-serif text-2xl leading-display text-fg">{strings.title}</h2>
          <p className="text-sm leading-6 text-fg-muted">{strings.body}</p>
          <p className="break-words font-mono text-xs text-fg-subtle">{error.message}</p>
          <div className="pt-2">
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              {strings.retry}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export function FeatureErrorBoundary(props: {
  surface: string;
  resetKey?: unknown;
  children: ReactNode;
}) {
  const { t } = useTranslation("common");
  return (
    <Boundary
      surface={props.surface}
      resetKey={props.resetKey}
      strings={{
        title: t("errorBoundary.title"),
        body: t("errorBoundary.body"),
        retry: t("errorBoundary.retry"),
      }}
    >
      {props.children}
    </Boundary>
  );
}
