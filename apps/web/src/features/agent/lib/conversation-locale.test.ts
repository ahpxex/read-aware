import { expect, test } from "bun:test";
import { conversationLocale } from "./conversation-locale";

test("a reader who asks in Chinese is offered Chinese, whatever the interface language", () => {
  expect(conversationLocale(["我最近读了多少？", "非洲长啥样"], "en")).toBe("zh-Hans");
  expect(conversationLocale(["我最近读了多少？"], "de")).toBe("zh-Hans");
  // The interface settles Simplified or Traditional.
  expect(conversationLocale(["我最近讀了多少？"], "zh-Hant")).toBe("zh-Hant");
});

test("the script picks the language; the interface settles which Latin-script one", () => {
  expect(conversationLocale(["今月はどれくらい読んだ？"], "en")).toBe("ja");
  expect(conversationLocale(["Сколько я читаю?"], "en")).toBe("ru");
  expect(conversationLocale(["What did I read?"], "fr")).toBe("fr");
  expect(conversationLocale(["What did I read?"], "zh-Hans")).toBe("en");
});

test("the majority of recent messages decides; a tie goes to the newest", () => {
  expect(conversationLocale(["hi", "我是谁", "邓小平是谁", "非洲长啥样"], "en")).toBe("zh-Hans");
  expect(conversationLocale(["hi", "我是谁"], "en")).toBe("en");
  expect(conversationLocale(["我是谁", "hi"], "en")).toBe("zh-Hans");
  // Only the five most recent count.
  expect(conversationLocale(["a", "b", "c", "d", "e", "我", "我", "我", "我", "我", "我"], "en")).toBe("en");
});

test("nothing to read, no letters, or a script without a catalog leaves the interface language", () => {
  expect(conversationLocale([], "ja")).toBe("ja");
  expect(conversationLocale(["123 ?!", ""], "de")).toBe("de");
  expect(conversationLocale(["내가 읽은 책"], "en")).toBe("en");
});
