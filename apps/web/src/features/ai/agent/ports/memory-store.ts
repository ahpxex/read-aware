/**
 * 记忆的产品侧存储：SQLite `memories` 表（storage.rs 迁移 v5，
 * docs/data-model.md §5.2 的 v1）。无浏览器降级 —— agent 只在桌面壳里运行，
 * 浏览器构建是纯 UI（mock transport），真跑到这里就该炸出来而不是静默降级。
 */
import { invoke } from "@tauri-apps/api/core";
import type { MemoryRecord } from "@read-aware/agent";
import { isTauri } from "../../../../platform/environment";

function assertDesktop(): void {
  if (!isTauri()) {
    throw new Error("Agent memory lives in the desktop SQLite store — run the desktop app.");
  }
}

/** SQLite 侧 status 恒有值；pinned 恒为布尔。与 MemoryRecord 的可选字段兼容。 */
type MemoryRow = MemoryRecord & { pinned: boolean; status: NonNullable<MemoryRecord["status"]> };

function toRow(record: MemoryRecord): MemoryRow {
  return {
    ...record,
    pinned: record.pinned ?? false,
    status: record.status ?? "active",
  };
}

export async function listAllMemoryRows(): Promise<MemoryRecord[]> {
  assertDesktop();
  return invoke<MemoryRow[]>("memories_list_all");
}

export async function putMemoryRow(record: MemoryRecord): Promise<void> {
  assertDesktop();
  await invoke("memory_put", { memory: toRow(record) });
}

export async function getMemoryRow(id: string): Promise<MemoryRecord | undefined> {
  assertDesktop();
  return (await invoke<MemoryRow | null>("memory_get", { id })) ?? undefined;
}
