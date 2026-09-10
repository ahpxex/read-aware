export type DuplicateBookQuery = { offset?: number; limit?: number };
export type DuplicateBookGroup = { bookId: string; title: string; count: number };
export type DuplicateBookPage = { groups: DuplicateBookGroup[]; total: number; nextOffset: number | null };
export type BookMergeMember = { id: string; title: string; author: string; createdAt: string };
export type BookMergePreview = { revision: string; keep: BookMergeMember; merged: BookMergeMember[] };
export type BookMergeRequest = { bookId: string; expectedRevision: string };
export type BookMergeReceipt = { committed: true; keepId: string; redirects: { from: string; to: string }[] };
