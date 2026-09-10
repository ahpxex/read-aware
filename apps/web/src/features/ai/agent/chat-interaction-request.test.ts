import { expect, test } from "bun:test";
import { toChatInteractionRequest } from "./chat-interaction-request";

test("graph approval keeps its chapter limit through chat presentation without altering other permissions", () => {
  const request = { id: "call", threadKey: "book:b", kind: "permission" as const, action: "generate-book-graph" as const, subject: "Book", maxChapters: 3 };
  expect(toChatInteractionRequest(request)).toEqual(request);
  const legacy = { id: "old", threadKey: "book:b", kind: "permission" as const, action: "delete-book" as const, subject: "Book" };
  expect(toChatInteractionRequest(legacy)).toEqual(legacy);
  const plugin = { ...legacy, action: "plugin-tool" as const, subject: 'Dictionary (dictionary) / delete_saved_word\n{"id":"en:word"}' };
  expect(toChatInteractionRequest(plugin)).toEqual(plugin);
  const download = { ...legacy, action: "download-resource" as const, subject: "book.epub\nhttps://example.com/book.epub" };
  expect(toChatInteractionRequest(download)).toEqual(download);
});

test("all graph approval translations disclose the subject and resolved chapter limit", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    const json = await Bun.file(new URL(`../../../i18n/locales/${locale}/ai.json`, import.meta.url)).json();
    const description = json.chat.interaction.permission.generateBookGraph.description;
    expect(description).toContain("{{subject}}");
    expect(description).toContain("{{maxChapters}}");
    expect(json.chat.interaction.permission.pluginTool.description).toContain("{{subject}}");
    expect(json.chat.interaction.permission.pluginTool.question.length).toBeGreaterThan(0);
    expect(json.chat.interaction.permission.pluginTool.approve.length).toBeGreaterThan(0);
    expect(json.chat.interaction.permission.downloadResource.description).toContain("{{subject}}");
    expect(json.chat.interaction.permission.downloadResource.description).toContain("64 MiB");
  }
});
