import type { Meta, StoryObj } from "@storybook/react-vite";
import { Trans } from "../../../i18n";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsPage } from "./SettingsPage";
import { SettingsRow } from "./SettingsRow";
import { Toggle } from "@read-aware/ui";

/**
 * The frame every settings section is built in: serif title, a lead
 * description, then a stack of groups. It owns the measure and the rhythm, so
 * no panel sets its own.
 */
const meta = {
  title: "Interface/Settings/SettingsPage",
  component: SettingsPage,
  parameters: { layout: "fullscreen" },
  args: {
    title: "Reading",
    description: "How books look and behave while you read them.",
    children: (
      <SettingsGroup title="Typography">
        <SettingsRow
          title="Justify text"
          description="Align both edges of the text block."
          control={<Toggle checked={false} onChange={() => {}} label="Justify text" />}
        />
      </SettingsGroup>
    ),
  },
} satisfies Meta<typeof SettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Title, description, and one group. */
export const Default: Story = {};

/** Some sections need no lead — the header collapses to the title alone. */
export const WithoutDescription: Story = {
  args: { description: undefined },
};

/** The description can carry markup, which is why it takes a node. */
export const RichDescription: Story = {
  args: {
    description: (
      <Trans
        ns="settings"
        i18nKey="about.diagnostics.description"
        components={{ strong: <strong /> }}
      />
    ),
  },
};

/** Several groups, showing the vertical rhythm the frame imposes. */
export const MultipleGroups: Story = {
  args: {
    children: (
      <>
        <SettingsGroup title="Typography">
          <SettingsRow
            title="Justify text"
            description="Align both edges of the text block."
            control={<Toggle checked onChange={() => {}} label="Justify text" />}
          />
          <SettingsRow
            title="Hyphenation"
            description="Break long words at line ends."
            control={<Toggle checked={false} onChange={() => {}} label="Hyphenation" />}
          />
        </SettingsGroup>
        <SettingsGroup title="Behaviour">
          <SettingsRow
            title="Keep the screen awake"
            control={<Toggle checked onChange={() => {}} label="Keep the screen awake" />}
          />
        </SettingsGroup>
      </>
    ),
  },
};

/** A long title has to wrap inside the measure rather than push it wider. */
export const LongTitleAndDescription: Story = {
  args: {
    title: "Data, synchronisation and account",
    description:
      "Where your library lives, which devices it reaches, and what leaves this machine. Everything synced is end-to-end encrypted; the relay only ever holds ciphertext it cannot read.",
  },
};
