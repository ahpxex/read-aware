/**
 * The menus feature's public surface for other features (see the
 * `features-via-public-index` dependency rule). Only what another feature
 * legitimately shares is exported here.
 */

// Settings → Customize embeds the header/footer strip arrangement editor.
export { HeaderFooterEditor, HeaderFooterEnabledToggle } from "./components/HeaderFooterEditor";

// Settings → Menus offers, and the phone reader follows, the toolbar's placement.
export { ReaderToolbarPlacementChoice } from "./components/ReaderToolbarPlacementChoice";
export { readerToolbarPlacementAtom, type ReaderToolbarPlacement } from "./state/reader-toolbar-placement";
