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
  const profile = { ...legacy, action: "update-profile" as const, subject: "New profile summary" };
  expect(toChatInteractionRequest(profile)).toEqual(profile);
});

test("all graph approval translations disclose the subject and resolved chapter limit", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    const json = await Bun.file(new URL(`../../../i18n/locales/${locale}/ai.json`, import.meta.url)).json();
    for (const key of ["required", "invalid", "choose"]) expect(json.chat.interaction.form[key].length).toBeGreaterThan(0);
    const description = json.chat.interaction.permission.generateBookGraph.description;
    expect(description).toContain("{{subject}}");
    expect(description).toContain("{{maxChapters}}");
    expect(json.chat.interaction.permission.pluginTool.description).toContain("{{subject}}");
    expect(json.chat.interaction.permission.pluginTool.question.length).toBeGreaterThan(0);
    expect(json.chat.interaction.permission.pluginTool.approve.length).toBeGreaterThan(0);
    expect(json.chat.interaction.permission.downloadResource.description).toContain("{{subject}}");
    expect(json.chat.interaction.permission.downloadResource.description).toContain("64 MiB");
    expect(json.chat.interaction.permission.updateProfile.description).toContain("{{subject}}");
    expect(json.chat.interaction.permission.updateProfile.approve.length).toBeGreaterThan(0);
  }
});

test("structured form requests are copied into presentation without losing field constraints", () => {
  const request = { kind: "form" as const, id: "f", threadKey: "global:t", title: "Plan",
    fields: [{ kind: "number" as const, id: "minutes", label: "Minutes", min: 1, max: 120, required: true }] };
  const presentation = toChatInteractionRequest(request);
  expect(presentation).toEqual(request);
  request.fields[0]!.min = 100;
  expect(presentation).toMatchObject({ fields: [{ min: 1 }] });
});
