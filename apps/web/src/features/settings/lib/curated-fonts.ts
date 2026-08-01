import { CURATED_FONT_FACES, type CuratedFontFace } from "./curated-fonts-data.generated";
export {
  CURATED_FONTS,
  curatedFallback,
  getCuratedFont,
  type CuratedFont,
  type CuratedFontKind,
} from "./curated-font-catalog";

/** The @font-face descriptors for one curated font. */
export function curatedFacesFor(id: string): CuratedFontFace[] {
  return CURATED_FONT_FACES.filter((face) => face.fontId === id);
}
