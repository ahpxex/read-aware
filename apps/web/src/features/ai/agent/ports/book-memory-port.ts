/**
 * BookMemoryPort over SQLite（chapter_digests 投影）。写路径事件先行：
 * saveDigest 提交 book.chapterDigested，apply.rs 在同一事务里物化投影行——
 * LLM 产物不可确定性重算，入事件流才可跨设备同步、可重放。
 * 读路径走 chapter_digests_list 命令；browser（非 Tauri）下静默空集，
 * 与其他投影读端的降级姿态一致。
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  BookMemoryPort,
  ChapterDigest,
  DigestCharacter,
  DigestRelation,
} from "@read-aware/agent";
import { commitDomainEvents } from "../../../../platform/domain-events";
import { isTauri } from "../../../../platform/environment";

/** Wire shape of the Rust `ChapterDigest` (camelCase serde). */
interface ChapterDigestRow {
  bookId: string;
  chapterIndex: number;
  chapterHref: string | null;
  summary: string;
  charactersJson: string;
  relationsJson: string;
  digestVersion: number;
  /** 提炼口径；null = narrative（口径分流之前的旧行）。 */
  flavor: string | null;
  updatedAt: string;
}

function parseCharacters(raw: string): DigestCharacter[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is DigestCharacter =>
        Boolean(item) && typeof item === "object" && typeof (item as { name?: unknown }).name === "string",
    );
  } catch {
    return [];
  }
}

function parseRelations(raw: string): DigestRelation[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is DigestRelation => {
      if (!item || typeof item !== "object") return false;
      const relation = item as Record<string, unknown>;
      return (
        typeof relation.from === "string" &&
        typeof relation.kind === "string" &&
        typeof relation.to === "string"
      );
    });
  } catch {
    return [];
  }
}

export function createBookMemoryPort(): BookMemoryPort {
  return {
    listDigests: async (bookId) => {
      if (!isTauri()) return [];
      const rows = await invoke<ChapterDigestRow[]>("chapter_digests_list", {
        bookId: String(bookId),
      });
      return rows.map<ChapterDigest>((row) => ({
        chapterIndex: row.chapterIndex,
        ...(row.chapterHref ? { chapterHref: row.chapterHref } : {}),
        summary: row.summary,
        characters: parseCharacters(row.charactersJson),
        relations: parseRelations(row.relationsJson),
        digestVersion: row.digestVersion,
        ...(row.flavor === "narrative" || row.flavor === "expository"
          ? { flavor: row.flavor }
          : {}),
      }));
    },
    saveDigest: async (bookId, digest) => {
      await commitDomainEvents({
        type: "book.chapterDigested",
        payload: {
          bookId,
          chapterIndex: digest.chapterIndex,
          ...(digest.chapterHref ? { chapterHref: digest.chapterHref } : {}),
          summary: digest.summary,
          characters: digest.characters,
          relations: digest.relations,
          digestVersion: digest.digestVersion,
          ...(digest.flavor ? { flavor: digest.flavor } : {}),
        },
        origin: "agent",
      });
    },
  };
}
