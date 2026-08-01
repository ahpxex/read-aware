import { describe, expect, test } from "bun:test";
import { createUserInteractionPort, respondToUserInteraction } from "./user-interaction-port";

describe("UserInteractionPort", () => {
  test("resolves a pending tool from the chat answer", async () => {
    const port = createUserInteractionPort();
    const answer = port.request({
      id: "interaction-resolve",
      threadKey: "global:thread-1",
      kind: "question",
      question: "Choose",
      options: [
        { id: "one", label: "One" },
        { id: "two", label: "Two" },
      ],
      allowCustom: true,
    });

    expect(
      respondToUserInteraction("interaction-resolve", { optionId: "two", text: "Two" }),
    ).toBe(true);
    await expect(answer).resolves.toEqual({ optionId: "two", text: "Two" });
    expect(respondToUserInteraction("interaction-resolve", { text: "late" })).toBe(false);
  });

  test("rejects and removes the resolver when the agent turn aborts", async () => {
    const port = createUserInteractionPort();
    const controller = new AbortController();
    const answer = port.request(
      {
        id: "interaction-abort",
        threadKey: "book:book-1",
        kind: "permission",
        action: "delete-book",
        subject: "The Book",
      },
      controller.signal,
    );
    controller.abort();

    await expect(answer).rejects.toMatchObject({ name: "AbortError" });
    expect(
      respondToUserInteraction("interaction-abort", { optionId: "approve" }),
    ).toBe(false);
  });
});
