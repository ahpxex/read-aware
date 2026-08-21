import { describe, expect, test } from "bun:test";
import {
  hasExplicitSpoilerPermission,
  interactionGrantsSpoilerPermission,
} from "./spoiler-permission";

describe("spoiler permission", () => {
  test("recognizes explicit reader grants without treating curiosity as permission", () => {
    expect(hasExplicitSpoilerPermission("别管剧透，直接告诉我结局")).toBe(true);
    expect(hasExplicitSpoilerPermission("我不怕剧透，讲吧")).toBe(true);
    expect(hasExplicitSpoilerPermission("Spoilers are okay; tell me what happens.")).toBe(true);
    expect(hasExplicitSpoilerPermission("给我讲讲宗教大法官那段")).toBe(false);
    expect(hasExplicitSpoilerPermission("先别剧透，后面的变化适合聊吗？")).toBe(false);
  });

  test("accepts only an affirmative answer to an explicit permission question", () => {
    const options = [
      { id: "allow", label: "可以" },
      { id: "safe", label: "别剧透" },
    ];
    expect(
      interactionGrantsSpoilerPermission({
        question: "可以剧透后面的内容吗？",
        options,
        answer: { optionId: "allow", text: "可以" },
      }),
    ).toBe(true);
    expect(
      interactionGrantsSpoilerPermission({
        question: "可以剧透后面的内容吗？",
        options,
        answer: { optionId: "safe", text: "别剧透" },
      }),
    ).toBe(false);
  });
});
