import { Fragment } from "react";
import { Kbd } from "@read-aware/ui";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { PendingBadge } from "../components/PendingBadge";
import { getShortcutGroups } from "../lib/shortcuts";

export function ShortcutsPanel() {
  const groups = getShortcutGroups();

  return (
    <SettingsPage
      title="Shortcuts"
      description="Keyboard shortcuts the app honors today. Custom rebinding is coming soon."
    >
      {groups.map((group) => (
        <SettingsGroup key={group.category} title={group.category}>
          {group.items.map((item, index) => (
            <SettingsRow
              key={item.id}
              borderless={index === 0}
              title={item.label}
              control={
                <span className="flex items-center gap-1">
                  {item.keys.map((key, keyIndex) => (
                    <Fragment key={key}>
                      {keyIndex > 0 && (
                        <span className="px-0.5 text-[11px] text-fg-subtle">+</span>
                      )}
                      <Kbd>{key}</Kbd>
                    </Fragment>
                  ))}
                </span>
              }
            />
          ))}
        </SettingsGroup>
      ))}

      <SettingsGroup title="Customize" aside={<PendingBadge />}>
        <p className="font-sans text-[13px] leading-5 text-fg-muted">
          Rebinding shortcuts and resolving conflicts will land alongside a configurable
          keybinding layer.
        </p>
      </SettingsGroup>
    </SettingsPage>
  );
}
