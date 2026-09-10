import type { ContextActionInput, RegisteredContextAction } from "./plugin-types";
import { actionEnabled, actionVisible } from "./plugin-action-state";
import { contributionText } from "./plugin-i18n";
import { renderPluginIcon } from "./plugin-icons";
import { runPluginContribution } from "./run-result";

export function contextActionItems(actions: RegisteredContextAction[], input: ContextActionInput) {
  // Never forward a LibraryBook or Collection object wholesale across the Worker boundary.
  const target: ContextActionInput = input.surface === "book"
    ? { surface: "book", book: { id: input.book.id, title: input.book.title, author: input.book.author } }
    : { surface: "collection", collection: { id: input.collection.id, name: input.collection.name } };
  return actions.filter(action => action.surface === target.surface && actionVisible(action)).map(action => ({
    label: contributionText(action.title),
    icon: renderPluginIcon(action.icon, 15),
    disabled: !actionEnabled(action),
    checked: action.state?.checked,
    onClick: () => {
      void runPluginContribution(action.pluginId, action.pluginName, () => action.run(structuredClone(target)), {
        presentation: action.presentation,
        owner: action.run,
      });
    },
  }));
}
