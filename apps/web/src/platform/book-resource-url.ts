/**
 * The native shell's book resources: `rablob://localhost/<kind>/<bookId>/<sha256>/…`
 * (see `book_files.rs`). The content hash pins a URL to the file it was minted
 * for, which makes every response immutable.
 */
import { AppError } from "@read-aware/core";
import { customSchemeUrl } from "./custom-scheme";

export type BookResourcePort = {
  resourceUrl(path: string): string;
  fetch(url: string): Promise<Response>;
};

export const nativeBookResources: BookResourcePort = {
  resourceUrl: (path) => customSchemeUrl("rablob", path),
  fetch: (url) => fetch(url),
};

/** The path prefix of one book's resources of a kind (`book`, `palm`). */
export function bookResourceBase(kind: string, bookId: string, contentVersion: string): string {
  return `${kind}/${encodeURIComponent(bookId)}/${contentVersion.replace(/^sha256:/, "")}/`;
}

/**
 * Fetch a resource the shell lists, so a refusal is never "no such entry":
 * 422 says the file could not be read as its format (the book is damaged),
 * anything else that the file changed or is gone.
 */
export async function fetchBookResource(port: BookResourcePort, url: string, what: string): Promise<Response> {
  let response: Response;
  try {
    response = await port.fetch(url);
  } catch (error) {
    throw new AppError("library/content-unavailable", `${what} could not be read`, { cause: error });
  }
  if (response.status === 422) throw new AppError("book/parse-failed", `${what} is damaged`);
  if (!response.ok) throw new AppError("library/content-unavailable", `${what} could not be read (${response.status})`);
  return response;
}
