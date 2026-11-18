/**
 * Base URL of the landing site (readaware.app) for links the app opens in the
 * system browser. Like the relay URL, development overrides require the dev
 * server or a ReadAware Dev identity: Bun can preload .env.development even
 * when Vite is building for production.
 */
import { isDevBundle } from "./app-identity";

export function siteBaseUrl(): string {
  if (!import.meta.env.DEV && !isDevBundle()) return "https://readaware.app";
  const dev = import.meta.env.VITE_READAWARE_SITE_URL as string | undefined;
  return dev || "https://readaware.app";
}

/** Public project destinations shared by the update notice and About. */
export const PROJECT_REPOSITORY_URL = "https://github.com/ahpxex/read-aware";
export const PROJECT_DISCORD_URL = "https://discord.gg/whDrKXwHWU";
export const PROJECT_AUTHOR_URL = "https://ahpx.me";

/**
 * The invitation to the WeChat readers' group, offered to Chinese-language
 * readers beside the Discord link.
 *
 * WeChat issues a group invitation for seven days and no longer, so the link
 * is kept with the moment it lapses and is only handed out before then: a
 * build that outlives its invitation shows no code rather than a dead one.
 * Replacing the invitation means replacing both values together.
 */
const WECHAT_GROUP_INVITATION = {
  url: "https://weixin.qq.com/g/AwYAAJVfpVkx_cttjFV42qHiUextPEB3UaT8oWEHyuDcZuEsn3xVYzlQcawghObu",
  /** WeChat marked it valid "until 11/25"; read as up to, not through, that day in Beijing. */
  lapsesAt: Date.parse("2026-11-25T00:00:00+08:00"),
};

/** The WeChat group invitation while it still works, otherwise null. */
export function wechatGroupInvitationUrl(now: number): string | null {
  return now < WECHAT_GROUP_INVITATION.lapsesAt ? WECHAT_GROUP_INVITATION.url : null;
}
