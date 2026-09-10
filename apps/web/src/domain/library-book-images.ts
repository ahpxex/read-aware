import { AppError, normalizeBookImageQuery, type BookImageQuery, type BookImageResource } from "@read-aware/core";
import type { ResourceOwner } from "../services/resource-owner";
import { readBookImage, type BookImageData } from "../features/library/lib/book-images";

export async function openBookImageResource(owner: ResourceOwner, input: BookImageQuery, signal?: AbortSignal,
  allowedHrefs?: readonly string[]): Promise<BookImageResource> {
  const query = normalizeBookImageQuery(input), hrefs = allowedHrefs && [...allowedHrefs];
  let data: BookImageData | undefined;
  const resource = await owner.importImage(query.image.bookId, async () => {
    data = await readBookImage(query, signal, hrefs);
    return data.status === "ready" ? data.blob : null;
  }, signal);
  if (!data) throw new AppError("internal", "Image loader did not run");
  if (data.status !== "ready") return data;
  if (!resource) throw new AppError("internal", "Image resource was not sealed");
  return { status: "ready", image: data.image, resource };
}
