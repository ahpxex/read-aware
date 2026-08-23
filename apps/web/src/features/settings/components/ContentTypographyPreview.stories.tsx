import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContentTypographyPreview } from "./ContentTypographyPreview";

/** The `ra-content-type` custom properties, as the settings write them. */
type ContentTypeVars = {
  "--ra-content-font-size"?: string;
  "--ra-content-line-height"?: string;
  "--ra-content-font-family"?: string;
};

/**
 * The live sample under the content-typography settings.
 *
 * It is deliberately not a drawing of the settings: it reads the very same
 * `ra-content-type` custom properties the real surfaces do, so there is
 * nothing to keep in sync. These stories set those properties directly, which
 * is exactly what the settings controls do.
 */
const meta = {
  title: "Interface/Settings/ContentTypographyPreview",
  component: ContentTypographyPreview,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ContentTypographyPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Whatever the app's defaults currently resolve to. */
export const Default: Story = {};

function withVars(vars: ContentTypeVars) {
  return [
    (Story: () => React.ReactNode) => (
      <div style={vars as React.CSSProperties}>
        <Story />
      </div>
    ),
  ];
}

/** Larger body text, the most common adjustment. */
export const LargeText: Story = {
  decorators: withVars({ "--ra-content-font-size": "1.125rem" }),
};

/** Smaller text, for readers who want more on screen. */
export const SmallText: Story = {
  decorators: withVars({ "--ra-content-font-size": "0.8125rem" }),
};

/** Looser leading. */
export const RelaxedLeading: Story = {
  decorators: withVars({ "--ra-content-line-height": "2" }),
};

/** Tighter leading, where the two-turn shape gets denser. */
export const TightLeading: Story = {
  decorators: withVars({ "--ra-content-line-height": "1.35" }),
};

/** A serif content face. */
export const SerifFace: Story = {
  decorators: withVars({ "--ra-content-font-family": "Georgia, serif" }),
};

/** Everything pushed at once, the far end of the settings' range. */
export const LargeSerifRelaxed: Story = {
  decorators: withVars({
    "--ra-content-font-size": "1.25rem",
    "--ra-content-line-height": "2.1",
    "--ra-content-font-family": "Georgia, serif",
  }),
};
