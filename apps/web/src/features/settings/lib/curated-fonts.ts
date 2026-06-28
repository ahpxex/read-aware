import { CURATED_FONT_FACES, type CuratedFontFace } from "./curated-fonts-data.generated";

export type CuratedFontKind = "sans" | "serif" | "cjk";

export type CuratedFont = {
  id: string;
  label: string;
  /** CSS font-family name — matches the family in the generated @font-face data. */
  family: string;
  kind: CuratedFontKind;
};

/**
 * The curated reading fonts offered in the picker. None are bundled — each is
 * fetched and cached on demand the first time it's selected (see
 * `curated-font-loader`). Order is the display order.
 */
export const CURATED_FONTS: CuratedFont[] = [
  { id: "inter", label: "Inter", family: "Inter", kind: "sans" },
  { id: "atkinson", label: "Atkinson Hyperlegible", family: "Atkinson Hyperlegible", kind: "sans" },
  { id: "literata", label: "Literata", family: "Literata", kind: "serif" },
  { id: "lora", label: "Lora", family: "Lora", kind: "serif" },
  { id: "lxgw", label: "霞鹜文楷 LXGW WenKai", family: "LXGW WenKai", kind: "cjk" },
];

const CURATED_BY_ID = new Map(CURATED_FONTS.map((font) => [font.id, font]));

export function getCuratedFont(id: string): CuratedFont | undefined {
  return CURATED_BY_ID.get(id);
}

/** The @font-face descriptors for one curated font. */
export function curatedFacesFor(id: string): CuratedFontFace[] {
  return CURATED_FONT_FACES.filter((face) => face.fontId === id);
}

/** Generic CSS fallback appended after a curated family, chosen by its kind. */
export function curatedFallback(kind: CuratedFontKind): string {
  switch (kind) {
    case "serif":
      return "ui-serif, Georgia, serif";
    case "cjk":
      return '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ui-sans-serif, sans-serif';
    default:
      return "ui-sans-serif, system-ui, sans-serif";
  }
}
