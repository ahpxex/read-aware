/**
 * Verbal codenames per minor series — release titles and the website
 * changelog use them, and the About page shows the running build's one.
 * Patches inherit their minor's codename; tags and asset names never
 * carry it. Named when a minor series opens.
 */
const MINOR_CODENAMES: Record<string, string> = {
  "0.4": "El Alto",
};

/** The codename for a version string, or null for pre-codename series. */
export function versionCodename(version: string): string | null {
  const match = /^(\d+\.\d+)(?:\.|$|-)/.exec(version.trim());
  return match ? (MINOR_CODENAMES[match[1]] ?? null) : null;
}
