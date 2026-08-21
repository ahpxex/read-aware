/**
 * 读模型投影的防漂移测试。教训（2026-08）：narrativity 在 agent 的 eval
 * fixture 里设了很久，产品投影链（LibraryBook → BookSummary → BookOverview）
 * 却从没带过它——eval 在接缝处喂了产品从不提供的字段，剧透围栏因此在
 * 正式版里是死代码，而所有测试全绿。凡是"管线写入、agent 消费"的字段，
 * 投影必须有一条这样的直测。
 */
import { describe, expect, test } from "bun:test";
import type { LibraryBook } from "../features/library/lib/library-types";
import { toBookSummary } from "./shelf";

const base: LibraryBook = {
  id: "b1",
  title: "乌合之众",
  author: "勒庞",
  format: "epub",
  fileName: "b.epub",
  mimeType: "application/epub+zip",
  fileSize: 42,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  lastOpenedAt: null,
  progressPercent: 10,
  readingStatus: "reading",
  progress: null,
};

describe("toBookSummary", () => {
  test("carries narrativity through to the canonical read model", () => {
    expect(toBookSummary({ ...base, narrativity: "expository" }).narrativity).toBe("expository");
    expect(toBookSummary({ ...base, narrativity: "narrative" }).narrativity).toBe("narrative");
  });

  test("unclassified books stay undefined (fence and digest flavor stay conservative)", () => {
    expect(toBookSummary(base).narrativity).toBeUndefined();
    expect(toBookSummary({ ...base, narrativity: null }).narrativity).toBeUndefined();
  });
});
