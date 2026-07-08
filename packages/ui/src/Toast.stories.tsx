import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { Stack } from "./Stack";
import { ToastProvider, useToast } from "./Toast";

const meta = {
  title: "Design System/Components/Toast",
  component: ToastProvider,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ToastProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo() {
  const { toast } = useToast();
  return (
    <Stack gap={2} className="items-start">
      <Button
        variant="outline"
        onClick={() =>
          toast({
            title: "Import finished",
            description: "2 books imported · skipped 1 duplicate: “Atomic Habits”.",
          })
        }
      >
        Default toast
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast({
            variant: "destructive",
            title: "Import failed",
            description: "The file could not be read.",
          })
        }
      >
        Destructive toast
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast({
            variant: "success",
            description: "Backup restored.",
          })
        }
      >
        Success toast
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast({
            description: "This one stays until dismissed.",
            duration: 0,
          })
        }
      >
        Sticky toast
      </Button>
    </Stack>
  );
}

/** Fire toasts of each variant; they stack top-right and auto-dismiss after 6s. */
export const Playground: Story = {
  args: { children: null },
  render: () => (
    <ToastProvider>
      <Demo />
    </ToastProvider>
  ),
};
