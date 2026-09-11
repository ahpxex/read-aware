import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { createLibraryDomain } from "../../src/domain/library";
import { readingRuntime } from "../../src/domain/reading-runtime";
import { i18n } from "../../src/i18n";
import { runPluginContribution } from "../../src/features/plugins/lib/run-result";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const input = () => dialog()?.querySelector<HTMLTextAreaElement>("textarea");
const assert = (condition: unknown, message: string) => { if (!condition) throw Error(message); };
async function until(check: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw Error("Text Desk draft probe timed out");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function click(label: string) {
  const button = [...(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .find(button => button.textContent?.trim() === label || button.getAttribute("aria-label") === label);
  assert(button, `Missing button: ${label}`); button!.click();
}
function type(value: string) {
  const target = input(); assert(target, "Missing dialog query input");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(target, value);
  target!.dispatchEvent(new Event("input", { bubbles: true }));
}
async function search() { click("Search"); await until(() => !!dialog()?.querySelector("li button")); }
async function hit() { dialog()!.querySelector<HTMLButtonElement>("li button")!.click(); await until(() => dialog()?.textContent?.includes("Search this book") === true); }
async function backToForm(expected: string) {
  click("Back"); await until(() => !!input());
  assert(input()!.value === expected, `Draft lost: ${input()!.value}`);
}

/** Uses the compiled Text Desk Worker and actual host UI, never a copied form. */
export async function runTextDeskDraftProbe(bookId: string) {
  const dataDir = await appDataDir();
  assert(dataDir.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e"), "Use isolated capability-e2e app");
  assert(i18n.language.startsWith("en"), "Probe labels require isolated English UI");
  const book = await createLibraryDomain("user").queries.books.get(bookId);
  assert(book?.title.startsWith("Text State Probe normal "), "Use this run's synthetic text book");
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === "text-desk" && command.id === "open");
  assert(command, "Start compiled Text Desk first");
  await runPluginContribution("text-desk", "Text Desk", command!.run, { presentation: "dialog" });
  await until(() => dialog()?.textContent?.includes("Text Desk") === true && !!dialog()?.querySelector('[aria-label="Search indexed books"]'));
  click("Search indexed books"); await until(() => !!input());
  const first = "Text preparation probe\nchapter index", second = "Text index";
  click("Search"); await until(() => dialog()?.textContent?.includes("Enter 1-12 queries") === true);
  type(first); await until(() => !dialog()?.textContent?.includes("Enter 1-12 queries"));
  type(""); await new Promise(resolve => setTimeout(resolve, 30));
  assert(!dialog()?.textContent?.includes("Enter 1-12 queries"), "Old validation returned after editing");
  type(first); await search(); await backToForm(first);
  await search(); await hit(); click("Search this book"); await until(() => !!input());
  assert(input()!.value === "", "New frame inherited another form's field IDs");
  type(second); await search(); await backToForm(second);
  click("Back"); await until(() => dialog()?.textContent?.includes("Search this book") === true);
  click("Back"); await until(() => !!dialog()?.querySelector("li button"));
  await backToForm(first);
  const draft = { first: input()!.value, second, viewport: [innerWidth, innerHeight],
    pageOverflow: document.documentElement.scrollWidth > innerWidth,
    dialogOverflow: dialog()!.scrollWidth > dialog()!.clientWidth };
  assert(!draft.pageOverflow && !draft.dialogOverflow, "Form overflow");
  await search(); await hit(); click("Open book");
  await until(() => !dialog() && readingRuntime.snapshot().status === "ready" && readingRuntime.snapshot().bookId === bookId);
  return { dataDir, draft, openBook: { completed: true, bookId, status: readingRuntime.snapshot().status } };
}
