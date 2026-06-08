import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocalAtom } from "./lib/useLocalAtom";
import { Sidebar } from "./Sidebar";
import { Button } from "./Button";

const meta = {
  title: "Design System/Components/Sidebar",
  component: Sidebar,
  argTypes: {
    side: { control: "select", options: ["left", "right"] },
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Left: Story = {
  args: {
    side: "left",
    open: false,
    onClose: () => {},
    label: "Navigation",
    children: null,
  },
  render: (args) => {
    const [open, setOpen] = useLocalAtom(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open sidebar</Button>
        <Sidebar open={open} onClose={() => setOpen(false)} side={args.side} label="Navigation">
          <div className="p-6">
            <p className="text-sm text-stone-700">Sidebar content</p>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </Sidebar>
      </>
    );
  },
};

export const Right: Story = {
  args: {
    side: "right",
    open: false,
    onClose: () => {},
    label: "Context panel",
    children: null,
  },
  render: (args) => {
    const [open, setOpen] = useLocalAtom(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open sidebar</Button>
        <Sidebar open={open} onClose={() => setOpen(false)} side={args.side} label="Context panel">
          <div className="p-6">
            <p className="text-sm text-stone-700">Context panel</p>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </Sidebar>
      </>
    );
  },
};
