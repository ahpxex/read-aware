// Site-wide constants shared by the header, footer, and content pages.

export const CONTACT_EMAIL = "hi@ahpx.me";

/** The sync/billing relay; overridable for local end-to-end testing. */
export const RELAY_URL: string =
  (import.meta.env?.VITE_RELAY_URL as string | undefined) ?? "https://relay.readaware.app";
export const DISCORD_URL = "https://discord.gg/whDrKXwHWU";
export const HEADER_ICON_URL = "/favicon.png?v=2235eb1";

/** The community plugin registry (Settings → Plugins → Marketplace reads it). */
export const MARKETPLACE_REPO_URL = "https://github.com/ahpxex/readaware-plugins";
