import i18next from "i18next";

/**
 * The single i18next instance for the app. Kept in its own module so the
 * formatting layer can read the active language without importing the init /
 * React-binding code in `index.ts` (which would create an import cycle).
 */
export const i18n = i18next.createInstance();
