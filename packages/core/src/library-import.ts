import type { BookSummary } from "./read-models";
export type BookImportReceipt = { status: "imported" | "duplicate"; book: BookSummary };
