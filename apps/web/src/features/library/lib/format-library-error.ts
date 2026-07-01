import type { TFunction } from "i18next";

/**
 * Turn an unknown thrown value into a user-facing message. `t` is optional so
 * callers outside the shelf surface (e.g. the reader) can keep using it without
 * an i18n binding; when provided, the generic fallback is localized.
 */
export function formatLibraryError(error: unknown, t?: TFunction<"shelf">) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return t ? t("errors.generic") : "Something went wrong while updating your library.";
}
