/**
 * The library feature's public surface for other features (see the
 * `features-via-public-index` dependency rule). Only what another feature
 * legitimately shares is exported here.
 */

// Plugins open book images through the same reader as the in-app lightbox.
export { readBookImage } from "./lib/book-images";
