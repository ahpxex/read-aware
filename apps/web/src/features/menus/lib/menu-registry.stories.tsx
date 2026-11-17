import type { Meta, StoryObj } from "@storybook/react-vite";
import { useTranslation } from "../../../i18n";
import type { MenuSurface } from "../state/menu-config";
import { CORE_MENU_DEFAULTS, CORE_OVERFLOW_DEFAULTS } from "../state/menu-config";
import { CORE_DESTINATIONS, CORE_MENU_ITEMS, coreMenuMeta } from "./menu-registry";

const SURFACES: MenuSurface[] = ["shelfHeader", "readerHeader", "readerToolbar", "selection"];

/**
 * The core menu registry — every built-in item a customizable surface can
 * hold, with the icon and label the editor draws it with.
 *
 * It is a data table, not a component, but it is a *visual* contract: the
 * editor, the live bars and the overflow menu all render from it, so adding an
 * entry (or changing an icon) shows up here first.
 */
const meta = {
  title: "Interface/Menus/CoreMenuRegistry",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The built-in destinations and where each starts: the primary navigation
 *  or the shelf header — one place, never both. */
function DestinationTable() {
  const { t } = useTranslation("nav");
  const { t: tSettings } = useTranslation("settings");
  return (
    <div>
      <h3 className="font-serif text-lg text-fg">{tSettings("menus.surface.primaryNav")}</h3>
      <div className="mt-3 flex flex-col">
        {CORE_DESTINATIONS.map((destination) => (
          <div key={destination.id} className="flex items-center gap-3 border-t border-border py-2 first:border-t-0">
            <span className="text-fg-muted">
              <destination.Icon size={16} weight="regular" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 text-sm text-fg">{t(`header.${destination.labelKey}`)}</span>
            <code className="text-[11px] text-fg-subtle">{destination.id}</code>
            <span className="w-28 text-right text-xs text-fg-subtle">
              {CORE_MENU_DEFAULTS.primaryNav.includes(destination.id)
                ? tSettings("menus.surface.primaryNav")
                : tSettings("menus.surface.shelfHeader")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SurfaceTable({ surface }: { surface: MenuSurface }) {
  const { t } = useTranslation("settings");
  const items = CORE_MENU_ITEMS[surface];
  const visible = CORE_MENU_DEFAULTS[surface];
  const overflow = CORE_OVERFLOW_DEFAULTS[surface];

  return (
    <div>
      <h3 className="font-serif text-lg text-fg">{t(`menus.surface.${surface}` as never)}</h3>
      <div className="mt-3 flex flex-col">
        {items.map((item) => {
          const zone = visible.includes(item.id) ? "shown" : overflow.includes(item.id) ? "overflow" : "—";
          return (
            <div key={item.id} className="flex items-center gap-3 border-t border-border py-2 first:border-t-0">
              <span className="text-fg-muted">
                <item.Icon size={16} weight="regular" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 text-sm text-fg">{t(`menus.items.${item.labelKey}` as never)}</span>
              <code className="text-[11px] text-fg-subtle">{item.id}</code>
              <span className="w-20 text-right text-xs text-fg-subtle">{zone}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Every surface's core items, with the zone each one defaults to. */
export const AllSurfaces: Story = {
  render: () => (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <DestinationTable />
      {SURFACES.map((surface) => (
        <SurfaceTable key={surface} surface={surface} />
      ))}
    </div>
  ),
};

/** The destinations on their own — pages, never actions. */
export const Destinations: Story = {
  render: () => (
    <div className="mx-auto max-w-2xl">
      <DestinationTable />
    </div>
  ),
};

/** The selection menu, the densest of the four. */
export const Selection: Story = {
  render: () => (
    <div className="mx-auto max-w-2xl">
      <SurfaceTable surface="selection" />
    </div>
  ),
};

/**
 * `coreMenuMeta` is the lookup the surfaces use. An id belonging to another
 * surface — or to nothing at all — resolves to undefined rather than throwing,
 * so a stale saved layout degrades instead of breaking the bar.
 */
export const LookupMisses: Story = {
  render: () => {
    const probes: [MenuSurface, string][] = [
      ["shelfHeader", "core:search"],
      ["readerHeader", "core:search"],
      // Destinations are not per-surface actions: see CORE_DESTINATIONS.
      ["shelfHeader", "core:stats"],
      ["shelfHeader", "core:removed-long-ago"],
    ];
    return (
      <div className="mx-auto flex max-w-2xl flex-col">
        {probes.map(([surface, id]) => {
          const found = coreMenuMeta(surface, id);
          return (
            <div
              key={`${surface}/${id}`}
              className="flex items-center gap-3 border-t border-border py-2 first:border-t-0"
            >
              <code className="w-28 shrink-0 text-[11px] text-fg-subtle">{surface}</code>
              <code className="min-w-0 flex-1 text-[11px] text-fg-muted">{id}</code>
              <span className="text-sm text-fg">
                {found ? (
                  <span className="inline-flex items-center gap-2">
                    <found.Icon size={16} weight="regular" aria-hidden="true" />
                    {found.labelKey}
                  </span>
                ) : (
                  <span className="text-fg-subtle">undefined</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    );
  },
};
