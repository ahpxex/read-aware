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

// The app header renders the primary navigation and the shelf header from
// the resolved layouts, and shares the generic dots menu.
export { MenuOverflow, type MenuOverflowEntry } from "./components/MenuOverflow";
export { useMenuCatalog, useMenuLayouts } from "./hooks/useMenuLayouts";
// Pages are described once for the navigation, the shelf header and the
// command palette's "Go to" section.
export { useDestination, useDestinations, type Destination } from "./hooks/useDestinations";
export { isPluginPage } from "./lib/menu-catalog";
export { CORE_DESTINATIONS, coreDestination, type CoreDestinationMeta } from "./lib/menu-registry";
export { pluginMenuId } from "./state/menu-config";
