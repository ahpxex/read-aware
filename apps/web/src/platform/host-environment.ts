import { DEFAULT_LOCALE, i18n } from "../i18n";
import { isTauri, isMacOS, isWindows, isLinux } from "./environment";
import { createLogger } from "./logger";
import { HostEnvironmentStore } from "./host-environment-store";

const log = createLogger("host-environment");
export const hostEnvironment = new HostEnvironmentStore({
  read: () => {
    let timeZone: string | null = null;
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; }
    catch { /* Missing timezone data is represented as unknown, not guessed. */ }
    return {
      runtime: isTauri() ? "desktop" : "preview",
      platform: isMacOS() ? "macos" : isWindows() ? "windows" : isLinux() ? "linux" : "unknown",
      locale: i18n.language || DEFAULT_LOCALE,
      timeZone,
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
      networkHint: typeof navigator === "undefined" || typeof navigator.onLine !== "boolean" ? "unknown" : navigator.onLine ? "online" : "offline",
    };
  },
  watch: changed => {
    i18n.on("languageChanged", changed);
    const events = ["online", "offline", "focus", "pageshow"] as const;
    if (typeof window !== "undefined") for (const event of events) window.addEventListener(event, changed);
    // Timezone/DST changes have no portable WebView event. Queries also refresh.
    const timer = setInterval(changed, 30_000);
    return () => {
      clearInterval(timer);
      i18n.off("languageChanged", changed);
      if (typeof window !== "undefined") for (const event of events) window.removeEventListener(event, changed);
    };
  },
  report: error => log.warn("environment observer failed", error),
});
