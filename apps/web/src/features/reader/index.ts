/**
 * The reader feature's public surface for other features (see the
 * `features-via-public-index` dependency rule). Only what another feature
 * legitimately shares is exported here.
 */

// Navigation repair: the reader rebuilds a deficient TOC as a book opens, and
// text extraction rebuilds it for books too large to do so then.
export {
  navigationFromOutlines,
  navigationState,
  readSectionOutline,
  type SectionHeading,
  type SectionOutline,
} from "./lib/toc-synthesis";

// Settings uses the same touch motion for its mobile back navigation.
export { usePanelSwipeDismiss } from "./hooks/usePanelSwipeDismiss";
