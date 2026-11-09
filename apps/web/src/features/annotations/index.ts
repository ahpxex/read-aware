/**
 * The annotations feature's public surface for other features (see the
 * `features-via-public-index` dependency rule).
 */

// The reader lists and searches a book's marks.
export type { Annotation, Highlight, Note } from "./lib/annotation-types";

// The reader's notes view lists marks with the shared row.
export { AnnotationRow } from "./components/AnnotationRow";
