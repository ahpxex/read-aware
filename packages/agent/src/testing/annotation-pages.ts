import { AppError, normalizeAnnotationPageQuery, type AnnotationItem, type AnnotationPage, type AnnotationPageQuery } from "@read-aware/core";

/** In-memory port contract. Native FTS and SQL query plans have separate tests. */
export function annotationPageFixture(rows: AnnotationItem[], input?: AnnotationPageQuery): AnnotationPage {
  const query = normalizeAnnotationPageQuery(input);
  const scope = JSON.stringify([query.bookId ?? null, query.kind ?? null, query.query ?? null]);
  let after: { createdAt: string; id: string } | undefined;
  if (query.cursor) {
    try {
      const cursor = JSON.parse(query.cursor);
      if (cursor.scope !== scope || typeof cursor.createdAt !== "string" || typeof cursor.id !== "string") throw new Error("Invalid cursor");
      after = cursor;
    } catch (cause) { throw new AppError("annotations/invalid-cursor", "Invalid fixture cursor", { cause }); }
  }
  const matched = rows.filter(row => {
    const text = row.kind === "note" ? `${row.body}\n${row.quotedText ?? ""}` : row.text;
    return (!query.bookId || row.bookId === query.bookId) && (!query.kind || row.kind === query.kind)
      && (!query.query || text.includes(query.query))
      && (!after || row.createdAt < after.createdAt || (row.createdAt === after.createdAt && row.id < after.id));
  }).sort((a, b) => a.createdAt === b.createdAt ? (a.id > b.id ? -1 : a.id < b.id ? 1 : 0) : a.createdAt > b.createdAt ? -1 : 1);
  const items = matched.slice(0, query.limit);
  const last = items[items.length - 1];
  return { items, nextCursor: matched.length > items.length && last ? JSON.stringify({ scope, createdAt: last.createdAt, id: last.id }) : null, consistency: "live" };
}
