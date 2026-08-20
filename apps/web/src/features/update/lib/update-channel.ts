/**
 * The update channel preference: Stable follows GitHub's `releases/latest`
 * (never a pre-release); Beta follows the semver-largest release INCLUDING
 * pre-releases — which by semver ordering (0.4.0 > 0.4.0-beta.2) means beta
 * users also get any stable release that overtakes the betas, with no special
 * casing. Device-local (localKV), deliberately not roamed: opting one machine
 * into betas should not opt in every device on the account.
 */
import { localKV } from "../../../platform/local-store";

export type UpdateChannel = "stable" | "beta";

const CHANNEL_KV_KEY = "read-aware-update-channel";

export function getUpdateChannel(): UpdateChannel {
  return localKV.getItem(CHANNEL_KV_KEY) === "beta" ? "beta" : "stable";
}

export function setUpdateChannel(channel: UpdateChannel): void {
  if (channel === "stable") localKV.removeItem(CHANNEL_KV_KEY);
  else localKV.setItem(CHANNEL_KV_KEY, channel);
}
