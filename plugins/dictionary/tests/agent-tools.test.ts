import { expect, test } from "bun:test";
import type { PluginToolDefinition } from "@read-aware/plugin-types";
import { registerAgentTools } from "../src/agent-tools";
import type { DictionaryPluginContext } from "../src/types";

test("dictionary tools expose exact IDs, approved deletion and cancellable CSV export", async () => {
  const tools: PluginToolDefinition[] = [];
  const row = { id: "en:word", data: { term: "word", language: "en", entry: { headword: "word", senses: [{ definition: "meaning" }] }, addedAt: "today" } };
  let exists = true, saved = false, failDelete = false;
  const files: { content: string; mimeType: string }[] = [];
  const ctx = {
    contributions: { agentRetrievalProviders: { register() {} }, agentTools: { register: (tool: PluginToolDefinition) => { tools.push(tool); } } },
    services: {
      storage: { collection: () => ({ list: async () => exists ? [row] : [], get: async (id: string) => exists && id === row.id ? row : null,
        delete: async (id: string) => { expect(id).toBe(row.id); if (failDelete) throw Object.assign(Error("Locked"), { code: "db/locked" }); exists = false; } }) },
      ui: { exportFile: async (file: { content: string; mimeType: string }) => { files.push(file); return saved; } },
    },
  } as unknown as DictionaryPluginContext;
  registerAgentTools(ctx);
  const tool = (name: string) => tools.find(tool => tool.name === name)!;
  expect(await tool("get_vocabulary").execute({})).toMatchObject([{ id: row.id, term: "word" }]);
  const deletion = tool("delete_saved_word");
  expect(deletion.approval).toBe("required"); expect(deletion.contexts).toEqual(["global"]);
  const exporter = tool("export_vocabulary"); expect(exporter.contexts).toEqual(["global"]);
  expect(await exporter.execute({})).toEqual({ exported: false, count: 0 });
  saved = true;
  expect(await exporter.execute({})).toEqual({ exported: true, count: 1 });
  expect(files[0]!.content).toContain("meaning"); expect(files[0]!.mimeType).toContain("csv");
  failDelete = true;
  await expect(deletion.execute({ id: row.id })).rejects.toMatchObject({ code: "db/locked" }); expect(exists).toBe(true);
  failDelete = false;
  expect(await deletion.execute({ id: row.id })).toEqual({ deleted: true, id: row.id, term: "word" });
  expect(await deletion.execute({ id: row.id })).toEqual({ deleted: false, reason: "not-found" });
});
