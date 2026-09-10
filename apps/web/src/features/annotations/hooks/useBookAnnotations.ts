import { useAnnotations } from "./useAnnotations";

export function useBookAnnotations(bookId: string | null | undefined) {
  return useAnnotations(bookId ? { kind: "book", bookId } : null);
}
