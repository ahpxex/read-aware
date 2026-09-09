/** Non-sensitive host facts. No book, account, endpoint or hardware identifiers. */
export type HostEnvironmentSnapshot = {
  revision: number;
  runtime: "desktop" | "preview";
  platform: "macos" | "windows" | "linux" | "unknown";
  locale: string;
  timeZone: string | null;
  /** Minutes east of UTC, including the current daylight-saving offset. */
  utcOffsetMinutes: number;
  /** OS/WebView hint only, never a claim that sync or a model endpoint is reachable. */
  networkHint: "online" | "offline" | "unknown";
};
