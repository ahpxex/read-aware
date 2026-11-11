/**
 * The settings feature's public surface for other features (see the
 * `features-via-public-index` dependency rule). Only what another feature
 * legitimately shares is exported here.
 */

// The display mode: imperative motion (programmatic scrolling, deferred
// transitions, gesture settles, the reader's paging) honors the Motion
// setting, e-ink mode and the OS preference alike; e-ink mode itself decides
// the reader's swipe behavior and which page-color controls are offered.
export { isEinkActive, preferredScrollBehavior, prefersReducedMotion } from "./lib/app-settings";
export { useDisplayMode } from "./hooks/useDisplayMode";

// The reader's typography pipeline resolves a `user:` selection against the
// imported-font registry and emits its @font-face; the compact appearance
// popover labels it.
export { findUserFont, userFontFaceCss, userFontsAtom } from "./lib/user-fonts";

export { BUILTIN_READER_PALETTES } from "./lib/reader-theme";
export type { ReaderPalette } from "./lib/reader-theme";
export { ReaderBackgroundLayer } from "./components/ReaderBackgroundLayer";
// The reader's appearance popovers embed the same typography controls as the
// Reading settings panel.
export { ReaderTypographyControls } from "./components/ReaderTypographyControls";
