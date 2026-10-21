/**
 * The settings feature's public surface for other features (see the
 * `features-via-public-index` dependency rule). Only what another feature
 * legitimately shares is exported here.
 */

// Imperative motion (programmatic scrolling, deferred transitions) honors the
// in-app Motion setting as well as the OS preference.
export { prefersReducedMotion } from "./lib/app-settings";

// The reader's typography pipeline resolves a `user:` selection against the
// imported-font registry and emits its @font-face; the compact appearance
// popover labels it.
export { findUserFont, userFontFaceCss, userFontsAtom } from "./lib/user-fonts";

export { BUILTIN_READER_PALETTES } from "./lib/reader-theme";
export { ReaderBackgroundLayer } from "./components/ReaderBackgroundLayer";
