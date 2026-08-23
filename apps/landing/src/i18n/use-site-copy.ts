import { useTranslation } from "react-i18next";
import type { SiteResource } from ".";

export function useSiteCopy<Key extends keyof SiteResource>(
  key: Key,
): SiteResource[Key] {
  const { t } = useTranslation("site");
  return t(key, { returnObjects: true }) as SiteResource[Key];
}
