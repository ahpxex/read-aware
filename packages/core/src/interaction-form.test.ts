import { expect, test } from "bun:test";
import { validateInteractionForm, validateInteractionFormValues } from "./interaction-form";

const form = { title: "Reading plan", fields: [
  { id: "goal", kind: "text" as const, label: "Goal", required: true, maxLength: 10 },
  { id: "minutes", kind: "number" as const, label: "Minutes", min: 1, max: 120 },
  { id: "mode", kind: "select" as const, label: "Mode", options: [{ value: "slow", label: "Slow" }] },
  { id: "weekends", kind: "checkbox" as const, label: "Weekends", required: true },
] };

test("forms validate typed answers without treating false/zero/empty as consent or defaults", () => {
  const schema = validateInteractionForm(form);
  expect(validateInteractionFormValues(schema, { goal: "Read", weekends: false })).toEqual({
    values: { goal: "Read", minutes: null, mode: null, weekends: false }, errors: {},
  });
  expect(validateInteractionFormValues(schema, { goal: " ", minutes: 0, mode: "invented", weekends: "false" }).errors)
    .toEqual({ goal: "required", minutes: "invalid", mode: "invalid", weekends: "invalid" });
  expect(validateInteractionFormValues(schema, { goal: "x".repeat(11), minutes: NaN }).errors.goal).toBe("invalid");
  expect(() => validateInteractionFormValues(schema, { goal: "Read", approve: true })).toThrow();
  expect(validateInteractionFormValues({ title: "Zero", fields: [{ id: "n", label: "Number", kind: "number", required: true }] }, { n: 0 }))
    .toEqual({ values: { n: 0 }, errors: {} });
  schema.fields[0]!.label = "changed"; expect(form.fields[0]!.label).toBe("Goal");
});

test("form declarations reject secrets, unknown schema, duplicate IDs and excessive data", () => {
  for (const fields of [[], Array(9).fill(form.fields[0]), [form.fields[0], form.fields[0]],
    [{ ...form.fields[0], kind: "secret" }], [{ ...form.fields[0], id: "constructor" }],
    [{ ...form.fields[0], callback: "execute" }], [{ ...form.fields[0], maxLength: 4001 }],
    [{ ...form.fields[1], min: 5, max: 1 }], [{ ...form.fields[1], value: Infinity }],
    [{ ...form.fields[2], options: [{ value: "x", label: "X" }, { value: "x", label: "Y" }] }],
    [{ ...form.fields[2], value: "missing" }], [{ ...form.fields[0], value: "x".repeat(11) }]]) {
    expect(() => validateInteractionForm({ title: "Plan", fields })).toThrow();
  }
  expect(() => validateInteractionForm({ ...form, action: "approve" })).toThrow();
  expect(() => validateInteractionForm({ title: "Plan", fields: Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, kind: "textarea", label: "Text", value: "x".repeat(4000) })) })).toThrow();
});
