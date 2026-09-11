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

test("form answers are checked against an immutable request and invalid drafts do not settle", async () => {
  const port = createUserInteractionPort();
  const form = { id: "form", threadKey: "global:t", kind: "form" as const, title: "Plan",
    fields: [{ id: "minutes", label: "Minutes", kind: "number" as const, min: 1, required: true }] };
  const pending = port.request(form);
  form.fields[0]!.min = -10;
  expect(respondToUserInteraction("form", { optionId: "approve" })).toBe(false);
  expect(respondToUserInteraction("form", { values: { minutes: -1 } })).toBe(false);
  expect(respondToUserInteraction("form", { optionId: "approve", values: { minutes: 10 } })).toBe(true);
  expect(await pending).toEqual({ values: { minutes: 10 } });
  expect(respondToUserInteraction("form", { values: { minutes: 20 } })).toBe(false);
  const controller = new AbortController();
  const aborted = port.request({ ...form, id: "form-abort" }, controller.signal);
  controller.abort(); await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
  expect(respondToUserInteraction("form-abort", { values: { minutes: 10 } })).toBe(false);
});
