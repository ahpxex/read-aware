import type { TFunction } from "i18next";

/** Turn a thrown value into a reader-facing message. `t` is bound to `reader`. */
export function formatReaderError(error: unknown, t: TFunction<"reader">) {
  if (error instanceof Error && error.message) return error.message;
  return t("loadError");
}
