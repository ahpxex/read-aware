/**
 * The curated Phosphor set plugins may reference by name (docs/plugin-system.md
 * §6 — icons by name only, no custom SVG). A curated map keeps the icon library
 * tree-shakeable; extend deliberately rather than exposing the full catalog.
 */
import {
  ArrowSquareOut,
  Article,
  BookBookmark,
  BookOpen,
  Books,
  Brain,
  CalendarBlank,
  Cards,
  ChartLineUp,
  ChatCircleDots,
  Check,
  Clipboard,
  CloudArrowUp,
  Copy,
  Database,
  DownloadSimple,
  Export,
  FileText,
  Folder,
  Globe,
  GraduationCap,
  Highlighter,
  Lightbulb,
  Link,
  ListBullets,
  MagnifyingGlass,
  NotePencil,
  Notebook,
  Paragraph,
  PuzzlePiece,
  Quotes,
  Rows,
  Share,
  Sparkle,
  Star,
  Tag,
  TextAa,
  Translate,
  Trash,
  UploadSimple,
  type Icon,
  type IconWeight,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

const PLUGIN_ICONS: Record<string, Icon> = {
  "arrow-square-out": ArrowSquareOut,
  article: Article,
  "book-bookmark": BookBookmark,
  "book-open": BookOpen,
  books: Books,
  brain: Brain,
  calendar: CalendarBlank,
  cards: Cards,
  "chart-line-up": ChartLineUp,
  "chat-circle-dots": ChatCircleDots,
  check: Check,
  clipboard: Clipboard,
  "cloud-arrow-up": CloudArrowUp,
  copy: Copy,
  database: Database,
  "download-simple": DownloadSimple,
  export: Export,
  "file-text": FileText,
  folder: Folder,
  globe: Globe,
  "graduation-cap": GraduationCap,
  highlighter: Highlighter,
  lightbulb: Lightbulb,
  link: Link,
  "list-bullets": ListBullets,
  "magnifying-glass": MagnifyingGlass,
  "note-pencil": NotePencil,
  notebook: Notebook,
  paragraph: Paragraph,
  "puzzle-piece": PuzzlePiece,
  quotes: Quotes,
  rows: Rows,
  share: Share,
  sparkle: Sparkle,
  star: Star,
  tag: Tag,
  "text-aa": TextAa,
  translate: Translate,
  trash: Trash,
  "upload-simple": UploadSimple,
};

/** Names accepted in contribution `icon` fields, for docs and validation. */
export const PLUGIN_ICON_NAMES = Object.keys(PLUGIN_ICONS);

/**
 * Resolve a contribution icon by name; unknown/missing names fall back to the
 * puzzle piece so third-party entries stay recognizably plugin-provided.
 */
export function renderPluginIcon(
  name: string | undefined,
  size = 16,
  weight: IconWeight = "regular",
): ReactNode {
  const Glyph = (name && PLUGIN_ICONS[name]) || PuzzlePiece;
  return <Glyph size={size} weight={weight} aria-hidden="true" />;
}
