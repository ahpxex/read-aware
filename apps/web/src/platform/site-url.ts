/**
 * Base URL of the landing site (readaware.app) for links the app opens in the
 * system browser. Same dev story as the relay URL in sync-scheduler.ts:
 * `VITE_READAWARE_SITE_URL` is baked only by a developer's dev server (see
 * apps/web/.env.development — the local `bun run dev:landing` on :5175); the
 * release pipeline sets no such variable, so production always falls through
 * to the real site.
 */
export function siteBaseUrl(): string {
  const dev = import.meta.env.VITE_READAWARE_SITE_URL as string | undefined;
  return dev || "https://readaware.app";
}
