/**
 * The app's logging seam. Modules log through `createLogger("<module>")`
 * instead of raw `console.*`: the console keeps its dev-time role unchanged,
 * and inside Tauri every line is ALSO forwarded to the rotating log file the
 * desktop shell writes (tauri-plugin-log — see build_log_plugin in
 * apps/desktop/src-tauri/src/lib.rs). That file is the only trace a
 * production run leaves; it is read back by the diagnostics bundle, which the
 * user exports or reports explicitly — never automatically.
 *
 * Rules of the seam:
 * - Forwarding is fire-and-forget and can never throw into the caller.
 * - Log MESSAGES must not contain user content (book titles, highlight or
 *   chat text) — ids and error text only. The diagnostics bundle is meant to
 *   be safe to share.
 * - Worker code (the plugin sandbox) has no Tauri IPC and must keep raw
 *   console; its errors reach this seam through the host's onerror handler.
 */
import { isTauri } from "./environment";

type ForwardLevel = "info" | "warn" | "error";

/** One log call's payload cap in the file — errors, not data dumps. */
const MAX_DETAIL_CHARS = 2000;

/**
 * Render one detail value for the log file. Errors carry their stack (JSC
 * stacks omit name/message, V8 stacks repeat them — prefer completeness over
 * de-duplication) and one level of `cause`.
 */
function describe(value: unknown): string {
  if (value instanceof Error) {
    const head = `${value.name}: ${value.message}`;
    const stack = value.stack ?? "";
    let text = stack.includes(value.message) && stack.startsWith(value.name) ? stack : [head, stack].filter(Boolean).join("\n");
    if (value.cause instanceof Error) {
      text += `\ncaused by ${value.cause.name}: ${value.cause.message}`;
    } else if (value.cause !== undefined) {
      text += `\ncaused by ${String(value.cause)}`;
    }
    return text;
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function renderLine(module: string, message: string, detail: unknown[]): string {
  const parts = [`[${module}] ${message}`, ...detail.map(describe)];
  const line = parts.join(" · ");
  return line.length > MAX_DETAIL_CHARS ? `${line.slice(0, MAX_DETAIL_CHARS)}…` : line;
}

/**
 * Lazy so importing the logger stays free of Tauri modules in the browser /
 * Storybook build, and so a failed plugin import degrades to console-only.
 */
let filePort: Promise<Record<ForwardLevel, (message: string) => Promise<void>> | null> | null = null;

function fileLog(): Promise<Record<ForwardLevel, (message: string) => Promise<void>> | null> {
  if (!filePort) {
    filePort = isTauri()
      ? import("@tauri-apps/plugin-log")
          .then(({ info, warn, error }) => ({ info, warn, error }))
          .catch(() => null)
      : Promise.resolve(null);
  }
  return filePort;
}

function forward(level: ForwardLevel, module: string, message: string, detail: unknown[]): void {
  if (!isTauri()) return;
  void fileLog()
    .then((port) => port?.[level](renderLine(module, message, detail)))
    .catch(() => {
      // The logging seam must never become its own failure source.
    });
}

export type Logger = {
  /** Dev-only diagnostics: console in dev builds, never the log file. */
  debug(message: string, ...detail: unknown[]): void;
  info(message: string, ...detail: unknown[]): void;
  warn(message: string, ...detail: unknown[]): void;
  error(message: string, ...detail: unknown[]): void;
};

export function createLogger(module: string): Logger {
  const prefix = `[${module}]`;
  return {
    debug(message, ...detail) {
      if (import.meta.env.DEV) console.debug(prefix, message, ...detail);
    },
    info(message, ...detail) {
      console.info(prefix, message, ...detail);
      forward("info", module, message, detail);
    },
    warn(message, ...detail) {
      console.warn(prefix, message, ...detail);
      forward("warn", module, message, detail);
    },
    error(message, ...detail) {
      console.error(prefix, message, ...detail);
      forward("error", module, message, detail);
    },
  };
}
