/**
 * The imported-font domain surface.
 *
 * User fonts are real library data: the registry lives in the `user_fonts`
 * projection and the bytes in the synced blob store, so the whole set roams
 * with the event log. Mobile shells cannot enumerate OS font families — the
 * imported set is how a hand-picked font reaches the reader there.
 *
 * Not registered in DOMAIN_REGISTRY: the agent/plugin capability surface is a
 * deliberate, separately reviewed contract. The host UI calls these functions
 * directly; event subscription rides `observeFontInvalidation` plus the
 * `user-fonts-changed` app event (fired when blob bytes land locally).
 */
import { invoke } from "../platform/ipc";
import { isTauri } from "../platform/environment";
import { commitDomainEvents } from "../platform/domain-events";
import type { DomainActor } from "../platform/domain-actor";
import { observeFontInvalidation } from "./projection-invalidation";
import type { UserFontFormat } from "@read-aware/core";

/** One registry row — what `user_fonts_list` returns (camelCase serde). */
export type UserFontEntry = {
  id: string;
  name: string;
  format: UserFontFormat;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  blobKey: string;
  weight: number;
  /** Variable-font weight axis max when the face declares one. */
  weightMax?: number;
  italic: boolean;
  createdAt: string;
  /** Blob bytes are on this device (false = manifest known, download pending). */
  bytesLocal: boolean;
};

/** What `font_import_stage` staged: parsed metadata + stored blob key. */
export type StagedUserFont = {
  fontId: string;
  name: string;
  format: UserFontFormat;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  blobKey: string;
  weight: number;
  weightMax?: number;
  italic: boolean;
  /** The registry row already exists (re-import or a row that synced in). */
  alreadyPresent: boolean;
};

export async function listUserFonts(): Promise<UserFontEntry[]> {
  if (!isTauri()) return [];
  return invoke<UserFontEntry[]>("user_fonts_list");
}

/**
 * Stage a picked file: materialize it (Android content:// → cache copy),
 * validate size/format, parse name-table metadata, and register the blob.
 * Commits no event — the caller commits `userFont.imported` so import is
 * atomic with the domain write.
 */
export async function stageUserFontImport(path: string, fileName?: string): Promise<StagedUserFont> {
  return invoke<StagedUserFont>("font_import_stage", { path, fileName: fileName ?? null });
}

/** Commit the registry event after `stageUserFontImport` succeeded. */
export async function commitUserFontImported(origin: DomainActor | undefined, staged: StagedUserFont): Promise<void> {
  await commitDomainEvents({
    type: "userFont.imported",
    origin,
    payload: {
      fontId: staged.fontId,
      name: staged.name,
      format: staged.format,
      fileName: staged.fileName,
      mimeType: staged.mimeType,
      byteSize: staged.byteSize,
      sha256: staged.sha256,
      blobKey: staged.blobKey,
      weight: staged.weight,
      weightMax: staged.weightMax,
      italic: staged.italic,
    },
  });
}

/** Commit the removal event; the AFTER DELETE trigger queues blob release. */
export async function commitUserFontRemoved(
  origin: DomainActor | undefined,
  fontId: string,
  blobKey: string,
): Promise<void> {
  await commitDomainEvents({
    type: "userFont.removed",
    origin,
    payload: { fontId, blobKey },
  });
}

export { observeFontInvalidation };

/** Post-removal hook: native re-checks the row is gone, then frees bytes. */
export function releaseUserFontFiles(fontIds: string[]): Promise<void> {
  if (!isTauri() || fontIds.length === 0) return Promise.resolve();
  return invoke("user_fonts_release_files", { ids: fontIds });
}
