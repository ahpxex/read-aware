import type { Meta, StoryObj } from "@storybook/react-vite";
import { Star } from "@phosphor-icons/react";
import { Accordion } from "./Accordion";
import { Alert } from "./Alert";
import { Avatar } from "./Avatar";
import { Badge } from "./Badge";
import { Breadcrumb } from "./Breadcrumb";
import { Button } from "./Button";
import { Card } from "./Card";
import { Checkbox } from "./Checkbox";
import { ChoiceGroup } from "./ChoiceGroup";
import { DefinitionList } from "./DefinitionList";
import { Divider } from "./Divider";
import { DropdownMenu } from "./DropdownMenu";
import { EmptyState } from "./EmptyState";
import { IconButton } from "./IconButton";
import { Kbd } from "./Kbd";
import { NavItem } from "./NavItem";
import { Popover } from "./Popover";
import { Progress } from "./Progress";
import { Radio } from "./Radio";
import { Select } from "./Select";
import { Skeleton } from "./Skeleton";
import { Spinner } from "./Spinner";
import { Tabs } from "./Tabs";
import { Tag } from "./Tag";
import { TextArea } from "./TextArea";
import { TextField } from "./TextField";
import { Toggle } from "./Toggle";
import { Tooltip } from "./Tooltip";
import { Body } from "./typography/Body";
import { Caption } from "./typography/Caption";
import { Display } from "./typography/Display";
import { Eyebrow } from "./typography/Eyebrow";
import { Heading } from "./typography/Heading";

/**
 * A single-canvas audit of every control, used to verify the design system
 * reads correctly under both the light and dark app themes. Flip the "Theme"
 * toolbar control to compare. Every surface here is driven by the semantic
 * color tokens (fg / fg-muted / surface / fill / inverse-fg …), so nothing
 * should go dark-on-dark or light-on-light.
 */
const meta = {
  title: "Design System/Guidelines/Theme Audit",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <Eyebrow>{title}</Eyebrow>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

export const AllControls: Story = {
  render: () => (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-2">
        <Display size="5xl">Theme Audit</Display>
        <Body>
          Every control rendered on the token-driven canvas. Toggle the theme in the toolbar to
          confirm nothing disappears against the background.
        </Body>
        <Caption>Caption text — the quietest readable tier.</Caption>
      </header>

      <Divider />

      <Section title="Typography">
        <div className="space-y-2">
          <Heading size="2xl">Heading carries hierarchy</Heading>
          <Body>Body copy stays high-contrast in both themes.</Body>
          <Caption>Caption / metadata</Caption>
        </div>
      </Section>

      <Section title="Buttons">
        <Button>Solid</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
        <Button variant="danger">Danger</Button>
        <Button disabled>Disabled</Button>
        <IconButton label="Favorite" icon={<Star size={16} />} />
      </Section>

      <Section title="Form controls">
        <div className="w-64">
          <TextField label="Text field" placeholder="Type something" />
        </div>
        <div className="w-64">
          <TextArea label="Text area" placeholder="Longer input" />
        </div>
        <div className="w-64">
          <Select
            label="Select"
            defaultValue="a"
            options={[
              { label: "Option A", value: "a" },
              { label: "Option B", value: "b" },
            ]}
          />
        </div>
        <div className="space-y-3">
          <Checkbox label="Checkbox" defaultChecked />
          <Radio name="r" label="Radio" defaultChecked />
          <Toggle label="Toggle on" checked onChange={() => {}} />
          <Toggle label="Toggle off" checked={false} onChange={() => {}} />
        </div>
        <ChoiceGroup
          label="Choice group"
          value="b"
          onChange={() => {}}
          options={[
            { value: "a", label: "First" },
            { value: "b", label: "Second" },
            { value: "c", label: "Third" },
          ]}
        />
      </Section>

      <Section title="Data display">
        <Badge>Default</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="muted">Muted</Badge>
        <Tag>Tag</Tag>
        <Tag variant="outline">Outline tag</Tag>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
        <Avatar alt="Ada Lovelace" />
        <Spinner />
        <div className="w-48">
          <Progress value={62} label="Progress" showValue />
        </div>
        <Skeleton width="12rem" lines={3} />
      </Section>

      <Section title="Feedback">
        <div className="w-full space-y-3">
          <Alert title="Default">Neutral informational message.</Alert>
          <Alert variant="success" title="Success">It worked.</Alert>
          <Alert variant="destructive" title="Error">Something went wrong.</Alert>
        </div>
      </Section>

      <Section title="Navigation & overlays">
        <Breadcrumb items={[{ label: "Library" }, { label: "Book" }, { label: "Chapter" }]} />
        <div className="flex gap-6">
          <NavItem active>Active</NavItem>
          <NavItem>Inactive</NavItem>
        </div>
        <Tooltip content="Tooltip content">
          <Button variant="outline">Hover for tooltip</Button>
        </Tooltip>
        <DropdownMenu
          trigger={<Button variant="outline">Dropdown</Button>}
          items={[
            { label: "Edit", onClick: () => {} },
            { label: "Duplicate", onClick: () => {} },
            { label: "Delete", onClick: () => {}, destructive: true },
          ]}
        />
        <Popover trigger={<Button variant="outline">Popover</Button>}>
          <Body size="base">Popover body content.</Body>
        </Popover>
      </Section>

      <Section title="Containers">
        <Card className="w-72">
          <Card.Header>
            <Heading size="xl">Card</Heading>
          </Card.Header>
          <Card.Body>Card body text on a paper surface.</Card.Body>
        </Card>
        <div className="w-72">
          <Tabs
            items={[
              { label: "One", content: <Body>Panel one</Body> },
              { label: "Two", content: <Body>Panel two</Body> },
            ]}
          />
        </div>
        <div className="w-72">
          <Accordion
            items={[
              { label: "Accordion item", content: <Body>Hidden content.</Body> },
              { label: "Second item", content: <Body>More content.</Body> },
            ]}
          />
        </div>
        <DefinitionList
          items={[
            { label: "Version", value: "0.1.0" },
            { label: "Engine", value: "foliate-js" },
          ]}
        />
      </Section>

      <Section title="Empty state">
        <div className="w-full">
          <EmptyState
            title="Nothing here yet"
            description="An empty state rendered on the token canvas."
            action={<Button>Take action</Button>}
          />
        </div>
      </Section>
    </div>
  ),
};
