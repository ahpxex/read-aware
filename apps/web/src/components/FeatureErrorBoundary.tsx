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
  copyDetails: string;
  copied: string;
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
  copied: boolean;
};

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    log.error(`render crash in ${this.props.surface} surface`, error, info.componentStack ?? "");
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, copied: false });
    }
  }

  /** Hand the technical detail over without rendering it — same stance as the
   *  diagnostics bundle: the user chooses to share it, the UI stays clean. */
  copyDetails = () => {
    const { error } = this.state;
    if (!error) return;
    const detail = [`${error.name}: ${error.message}`, error.stack ?? ""].filter(Boolean).join("\n");
    navigator.clipboard?.writeText(detail).then(
      () => this.setState({ copied: true }),
      () => {},
    );
  };

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const { strings } = this.props;
    return (
      <div className="flex h-full min-h-64 w-full items-center justify-center bg-paper px-6 py-12 text-center">
        <div className="max-w-md space-y-3">
          <h2 className="font-serif text-2xl leading-display text-fg">{strings.title}</h2>
          <p className="text-sm leading-6 text-fg-muted">{strings.body}</p>
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button size="sm" onClick={() => this.setState({ error: null, copied: false })}>
              {strings.retry}
            </Button>
            <Button size="sm" variant="ghost" onClick={this.copyDetails}>
              {this.state.copied ? strings.copied : strings.copyDetails}
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
        copyDetails: t("errorBoundary.copyDetails"),
        copied: t("errorBoundary.copied"),
      }}
    >
      {props.children}
    </Boundary>
  );
}
