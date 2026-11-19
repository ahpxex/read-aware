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
 * - Worker code has no Tauri IPC. Plugins use services.logging for bounded
 *   structured events; sandbox infrastructure errors reach the host onerror.
 * - Error text is not always ours: a plugin names the method it called and
 *   writes its own messages and stacks, and a failed request names its URL.
 *   So every rendered line is made safe here, for every caller: continuation
 *   lines are indented (nothing can pose as a line of its own, which starts
 *   at column 0) and URLs lose their credentials and query strings.
 */
import { isTauri } from "./environment";

type ForwardLevel = "info" | "warn" | "error";

/**
 * One log call's payload cap in the file — errors, not data dumps. Room for
 * an error's stack and its cause's: a plugin failure's cause names the plugin
 * and carries the Worker-side stack.
 */
const MAX_DETAIL_CHARS = 4000;
/** How many `cause` links a logged error follows. */
const MAX_CAUSE_DEPTH = 2;

/**
 * Render one detail value for the log file. Errors carry their stack (JSC
 * stacks omit name/message, V8 stacks repeat them — prefer completeness over
 * de-duplication) and their `cause` chain, each rendered the same way.
 */
function describe(value: unknown, depth = 0): string {
  if (value instanceof Error) {
    const head = `${value.name}: ${value.message}`;
    const stack = value.stack ?? "";
    let text =
      stack.includes(value.message) && stack.startsWith(value.name) ? stack : [head, stack].filter(Boolean).join("\n");
    if (value.cause !== undefined) {
      text +=
        depth < MAX_CAUSE_DEPTH
          ? `\ncaused by ${describe(value.cause, depth + 1)}`
          : value.cause instanceof Error
            ? `\ncaused by ${value.cause.name}: ${value.cause.message}`
            : "";
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

/** One file log line; exported for its tests. */
export function renderLine(module: string, message: string, detail: unknown[]): string {
  const parts = [`[${module}] ${message}`, ...detail.map((value) => describe(value))];
  // Capped before redaction, so its cost stays bounded; a URL the cap cuts
  // in half no longer parses and is redacted whole.
  const joined = parts.join(" · ");
  const capped = joined.length > MAX_DETAIL_CHARS ? `${joined.slice(0, MAX_DETAIL_CHARS)}…` : joined;
  return redactUrls(capped).replace(/\n(?=\S)/g, "\n  ");
}

/**
 * A URL in a log line: a scheme, then everything up to the next whitespace.
 * Userinfo may hold any other character (quotes, parentheses), and a URL may
 * nest another in its query, so nothing narrower may end the token; a token
 * that swallowed several values is caught after parsing (`SWALLOWED`). The
 * line is capped before redaction, which bounds the token.
 */
const URL_TOKEN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
/** Closing punctuation that wraps a URL in prose and JSON, restored after redaction. */
const CLOSING = new Set([")", "]", "}", ">", '"', "'", "`", ",", ".", ";"]);
/**
 * A parsed path that may hide credentials: encoded quotes or brackets or a
 * nested scheme (several values run together), a leading `//` (an empty port
 * pushed another authority into the path), or an `@` (an authority the parser
 * did not take as one, or just `/@user.rss`). Such a path is redacted; the
 * parsed host stays to say which server the request went to.
 */
const SWALLOWED = /%22|%27|%60|%3C|%3E|:\/\/|@|^\/\//i;

/** `:12:34` at the very end of `value`, found by a linear scan; `""` otherwise. */
function framePosition(value: string): string {
  const last = value.lastIndexOf(":");
  const previous = last > 0 ? value.lastIndexOf(":", last - 1) : -1;
  if (previous < 0) return "";
  const digits = (text: string) => text.length > 0 && text.length <= 7 && /^\d+$/.test(text);
  return digits(value.slice(previous + 1, last)) && digits(value.slice(last + 1)) ? value.slice(previous) : "";
}

/**
 * `wss://user:secret@host/path?key=…#token` → `wss://<redacted>@host/path?<redacted>#<redacted>`:
 * keys and tokens ride in userinfo, query strings and fragments; scheme, host
 * and path stay to say which request failed. Each URL is parsed the way the
 * HTTP clients parse it (WHATWG), so what counts as userinfo or query is what
 * was sent. Whatever does not parse cleanly keeps only its scheme. A module
 * frame's `:line:column` after a query (dev builds load `x.ts?t=…`) is kept.
 */
function redactUrls(text: string): string {
  return text.replace(URL_TOKEN, (token) => {
    let end = token.length;
    while (end > 0 && CLOSING.has(token[end - 1]!)) end -= 1;
    const value = token.slice(0, end);
    const trailing = token.slice(end);
    const queryAt = value.search(/[?#]/);
    const module = /\.(c|m)?[jt]sx?$/.test(queryAt === -1 ? value : value.slice(0, queryAt));
    const position = module && queryAt !== -1 ? framePosition(value) : "";
    const raw = value.slice(0, value.length - position.length);
    const scheme = raw.slice(0, raw.indexOf("://") + 3);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return `${scheme}<redacted>${trailing}`;
    }
    const userinfo = url.username || url.password ? "<redacted>@" : "";
    if (SWALLOWED.test(url.pathname)) return `${url.protocol}//${userinfo}${url.host}/<redacted>${trailing}`;
    const query = url.search ? "?<redacted>" : "";
    const fragment = url.hash ? "#<redacted>" : "";
    return `${url.protocol}//${userinfo}${url.host}${url.pathname}${query}${fragment}${position}${trailing}`;
  });
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
          // Without the native log plugin the logger degrades to console-only.
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
