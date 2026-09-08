import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Checkbox, ChoiceGroup, Toggle } from "@read-aware/ui";

test("boolean and choice controls associate visible errors with their input/group", () => {
  for (const element of [
    <Checkbox label="Delete" description="Selected items" error="Confirm first" checked={false} onChange={() => {}} />,
    <ChoiceGroup label="Color" error="Conflict" value="yellow" options={[{ value: "yellow", label: "Yellow" }]} onChange={() => {}} />,
    <Toggle aria-label="Enable" error="Unavailable" checked={false} onChange={() => {}} />,
  ]) {
    const html = renderToStaticMarkup(element);
    expect(html).toContain('aria-invalid="true"');
    const described = html.match(/aria-describedby="([^"]+)"/)?.[1].split(" ");
    expect(described?.length).toBeGreaterThan(0);
    for (const id of described ?? []) expect(html).toContain(`id="${id}"`);
    expect(html).toMatch(/Confirm first|Conflict|Unavailable/);
  }
});

test("valid controls do not retain invalid states and checkbox external descriptions compose", () => {
  expect(renderToStaticMarkup(<ChoiceGroup value="a" options={[]} onChange={() => {}} />)).not.toContain("aria-invalid");
  expect(renderToStaticMarkup(<Toggle checked={false} onChange={() => {}} />)).not.toContain("aria-invalid");
  const html = renderToStaticMarkup(<Checkbox label="Delete" aria-describedby="external" error="Required" />);
  expect(html).toMatch(/aria-describedby="external [^"]+-error"/);
});
