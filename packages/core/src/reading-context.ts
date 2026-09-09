/** Separately declared book text for host-governed model input assembly.
 * This is not provenance verification for arbitrary prompt/system strings. */
export type ModelReadingContext = {
  selection?: string;
  surrounding?: string;
  /** Reject before inference if any named fragment is withheld; never guess it. */
  required?: Array<"selection" | "surrounding">;
};
