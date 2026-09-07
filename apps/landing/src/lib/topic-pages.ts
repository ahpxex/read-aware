import type { Locale } from "./i18n";

// Register only substantive pages with real routes and localized content.
export type TopicPage = { path: string; label: string };

export const TOPIC_PAGES: readonly TopicPage[] = [
  { path: "/open-source-ebook-reader", label: "Open-source ebook reader" },
  { path: "/epub-reader-for-windows", label: "EPUB reader for Windows" },
  { path: "/epub-reader-for-android", label: "EPUB reader for Android" },
  { path: "/cbz-cbr-reader", label: "CBZ & CBR comic reader" },
];

const CHINESE_TOPICS: readonly TopicPage[] = [
  { path: "/zh/epub-reader-for-windows", label: "Windows EPUB 阅读器" },
  { path: "/zh/epub-reader-for-android", label: "Android EPUB 阅读器" },
];

export function topicPagesForLocale(locale: Locale): readonly TopicPage[] {
  return locale === "en" ? TOPIC_PAGES : locale === "zh" ? CHINESE_TOPICS : [];
}
