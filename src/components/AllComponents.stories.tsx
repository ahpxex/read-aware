import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocalAtom } from "../state/local";
import { Display } from "./typography/Display";
import { Heading } from "./typography/Heading";
import { Body } from "./typography/Body";
import { Eyebrow } from "./typography/Eyebrow";
import { Caption } from "./typography/Caption";
import { Button } from "./Button";
import { Accordion } from "./Accordion";
import { Avatar } from "./Avatar";
import { Badge } from "./Badge";
import { Breadcrumb } from "./Breadcrumb";
import { Card } from "./Card";
import { Progress } from "./Progress";
import { Divider } from "./Divider";
import { EmptyState } from "./EmptyState";
import { TextField } from "./TextField";
import { TextArea } from "./TextArea";
import { Select } from "./Select";
import { Skeleton } from "./Skeleton";
import { Toggle } from "./Toggle";
import { IconButton } from "./IconButton";
import { Kbd } from "./Kbd";
import { DefinitionList } from "./DefinitionList";
import { Stack } from "./Stack";
import { Tabs } from "./Tabs";
import { Tooltip } from "./Tooltip";
import { Spinner } from "./Spinner";
import { Checkbox } from "./Checkbox";
import { Radio } from "./Radio";
import { Alert } from "./Alert";
import { Tag } from "./Tag";
import { DropdownMenu } from "./DropdownMenu";
import { Popover } from "./Popover";

/* ---- shared icons ---- */
const SearchIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
  </svg>
);
const BookIcon = (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M8 6h12a4 4 0 014 4v28a3 3 0 00-3-3H8V6z" />
    <path d="M40 6H28a4 4 0 00-4 4v28a3 3 0 013-3h13V6z" />
  </svg>
);
const MoreIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" />
  </svg>
);

/* ---- section wrapper ---- */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <Heading size="xl">{title}</Heading>
      <Divider />
      {children}
    </section>
  );
}

/* ---- main showcase ---- */
function AllComponentsShowcase() {
  const [toggle1, setToggle1] = useLocalAtom(false);
  const [toggle2, setToggle2] = useLocalAtom(true);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-12 py-8">
      {/* Typography */}
      <Section title="Typography">
        <Display size="5xl">Display -- Serif, large</Display>
        <Heading size="2xl">Heading -- Sans, medium</Heading>
        <Body>Body text with comfortable leading for long-form reading. The layout stays quiet so the content can breathe.</Body>
        <Eyebrow>Eyebrow -- uppercase, tracked</Eyebrow>
        <Caption>Caption -- small, secondary</Caption>
      </Section>

      {/* Buttons */}
      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="solid">Solid</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="solid" disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="solid" size="sm">Small</Button>
          <Button variant="solid" size="md">Medium</Button>
          <Button variant="solid" size="lg">Large</Button>
        </div>
        <div className="flex items-center gap-3">
          <IconButton icon={SearchIcon} label="Search" />
          <IconButton icon={MoreIcon} label="More" size="sm" />
        </div>
      </Section>

      {/* Navigation */}
      <Section title="Navigation">
        <Breadcrumb
          items={[
            { label: "Home", href: "#" },
            { label: "Library", href: "#" },
            { label: "Fiction" },
          ]}
        />
        <Tabs
          items={[
            { label: "All", content: <Body className="pt-3">Showing all items</Body> },
            { label: "Reading", content: <Body className="pt-3">Currently reading</Body> },
            { label: "Finished", content: <Body className="pt-3">Completed books</Body> },
          ]}
        />
      </Section>

      {/* Form Controls */}
      <Section title="Form Controls">
        <div className="grid grid-cols-2 gap-6">
          <TextField label="Title" placeholder="Enter a title..." />
          <TextField label="Author" placeholder="Author name" helperText="As it appears on the cover" />
          <TextField label="ISBN" error="Invalid ISBN format" defaultValue="978-0" />
          <TextField label="Search" placeholder="Search..." leadingIcon={SearchIcon} variant="outlined" />
        </div>
        <TextArea label="Notes" placeholder="Add your reading notes..." helperText="Markdown supported" />
        <TextArea label="Review" error="Review cannot be empty" variant="outlined" />
        <div className="grid grid-cols-2 gap-6">
          <Select
            label="Sort by"
            options={[
              { label: "Date added", value: "date" },
              { label: "Title", value: "title" },
              { label: "Author", value: "author" },
            ]}
            defaultValue="date"
          />
          <Select
            label="Genre"
            options={[
              { label: "Fiction", value: "fiction" },
              { label: "Non-fiction", value: "nonfiction" },
              { label: "Poetry", value: "poetry" },
            ]}
            placeholder="Choose..."
            variant="outlined"
            error="Required"
          />
        </div>
        <div className="flex items-center gap-8">
          <Toggle label="Dark mode" checked={toggle1} onChange={setToggle1} />
          <Toggle label="Notifications" checked={toggle2} onChange={setToggle2} />
        </div>
        <div className="flex gap-8">
          <div className="flex flex-col gap-2">
            <Checkbox label="Fiction" defaultChecked />
            <Checkbox label="Non-fiction" />
            <Checkbox label="Poetry" />
          </div>
          <div className="flex flex-col gap-2">
            <Radio name="speed" label="Slow" />
            <Radio name="speed" label="Normal" defaultChecked />
            <Radio name="speed" label="Fast" />
          </div>
        </div>
      </Section>

      {/* Data Display */}
      <Section title="Data Display">
        <div className="flex items-center gap-3">
          <Avatar initials="AL" size="lg" />
          <Avatar initials="JB" />
          <Avatar initials="UL" size="sm" />
          <div className="flex -space-x-2">
            <Avatar initials="AB" size="sm" />
            <Avatar initials="CD" size="sm" />
            <Avatar initials="EF" size="sm" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="muted">Muted</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Tag>Fiction</Tag>
          <Tag>Philosophy</Tag>
          <Tag variant="outline">New</Tag>
          <Tag onRemove={() => {}}>Removable</Tag>
        </div>
        <DefinitionList
          items={[
            { label: "Pages", value: "342" },
            { label: "Published", value: "1965" },
            { label: "Language", value: "English" },
          ]}
          columns={3}
        />
        <Progress value={65} label="Reading progress" showValue />
        <div className="flex items-center gap-3">
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" className="text-stone-950" />
        </div>
        <div className="flex gap-2"><Kbd>Cmd</Kbd><Kbd>K</Kbd></div>
      </Section>

      {/* Cards & Containers */}
      <Section title="Cards and Containers">
        <div className="grid grid-cols-2 gap-4">
          <Card variant="outlined">
            <Card.Header>
              <Eyebrow>Currently reading</Eyebrow>
            </Card.Header>
            <Card.Body>
              <Heading size="xl">Invisible Cities</Heading>
              <Caption>Italo Calvino</Caption>
            </Card.Body>
            <Card.Footer>
              <Progress value={42} size="sm" />
            </Card.Footer>
          </Card>
          <Card variant="filled">
            <Card.Header>
              <Eyebrow>Up next</Eyebrow>
            </Card.Header>
            <Card.Body>
              <Heading size="xl">The Left Hand of Darkness</Heading>
              <Caption>Ursula K. Le Guin</Caption>
            </Card.Body>
            <Card.Footer>
              <Button variant="link" size="sm">Start reading</Button>
            </Card.Footer>
          </Card>
        </div>
        <Accordion
          items={[
            { label: "What is RadAware?", content: "An AI-native reading application for context-rich reading and understanding." },
            { label: "How does it work?", content: "RadAware uses AI to provide contextual insights as you read, helping you understand and retain more." },
            { label: "Is it free?", content: "RadAware offers a generous free tier with premium features available for subscribers." },
          ]}
        />
      </Section>

      {/* Feedback & Overlays */}
      <Section title="Feedback and Overlays">
        <Alert title="Note" children="Your reading session has been saved." />
        <Alert variant="destructive" title="Error" children="Failed to sync your library." />
        <Alert variant="success" title="Done" children="Book added to your shelf." />
        <div className="flex items-center gap-4">
          <Tooltip content="Search your library">
            <Button variant="outline" size="sm">Hover me</Button>
          </Tooltip>
          <DropdownMenu
            trigger={<Button variant="outline" size="sm">Actions</Button>}
            items={[
              { label: "Edit", onClick: () => {} },
              { label: "Duplicate", onClick: () => {} },
              { label: "Delete", onClick: () => {}, destructive: true },
            ]}
          />
          <Popover
            trigger={<Button variant="ghost" size="sm">Info</Button>}
            children={<p className="text-sm text-stone-600">12 books read this year</p>}
          />
        </div>
        <EmptyState
          icon={BookIcon}
          title="Your shelf is empty"
          description="Add your first book to get started."
          action={<Button size="sm" variant="outline">Browse library</Button>}
        />
      </Section>

      {/* Skeleton */}
      <Section title="Skeleton Loading">
        <div className="flex items-start gap-4">
          <Skeleton variant="circular" width="48px" height="48px" />
          <div className="flex-1">
            <Skeleton variant="text" lines={3} />
          </div>
        </div>
      </Section>

      {/* Layout */}
      <Section title="Layout">
        <Stack direction="horizontal" gap="md">
          <div className="h-12 w-12 bg-stone-200" />
          <div className="h-12 w-12 bg-stone-300" />
          <div className="h-12 w-12 bg-stone-400" />
        </Stack>
        <Divider />
      </Section>
    </div>
  );
}

const meta = {
  title: "Design System/All Components",
  component: AllComponentsShowcase,
  parameters: { layout: "padded" },
} satisfies Meta<typeof AllComponentsShowcase>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Showcase: Story = {};
