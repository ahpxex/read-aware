import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { AppError } from "@read-aware/core";
import { Spinner } from "@read-aware/ui";
import logo from "../../../../../desktop/src-tauri/icons/128x128.png";
import type { PluginImageView } from "../lib/plugin-types";
import { registerPluginImageOwner } from "../lib/plugin-image-owner";
import { normalizePluginView } from "../lib/plugin-view";
import { decodePluginCallbacks } from "../runtime/plugin-callback-wire";
import { PluginImageViewBody } from "./PluginImageViewBody";

function ImageFixture({ aspectRatio = 1, missing = false }: { aspectRatio?: number; missing?: boolean }) {
  const [view, setView] = useState<PluginImageView | null>(null);
  useEffect(() => {
    const activation = new AbortController();
    const dispose = registerPluginImageOwner(activation.signal, async (_id, signal) => {
      if (missing) throw new AppError("fs/not-found", "Missing fixture");
      const response = await fetch(logo, { signal });
      if (!response.ok) throw new AppError("ui/unavailable", "Fixture image unavailable");
      return new Blob([await response.arrayBuffer()], { type: "image/png" });
    });
    const image = normalizePluginView(decodePluginCallbacks({ data: { kind: "image", resourceId: "logo", alt: "ReadAware", caption: "ReadAware", aspectRatio }, callbacks: [] }, () => null, undefined, activation.signal));
    if (image.kind === "image") setView(image);
    return () => { activation.abort(); dispose(); };
  }, [aspectRatio, missing]);
  return view ? <PluginImageViewBody view={view} /> : <Spinner size="sm" />;
}
const meta = { title: "Interface/Plugins/PluginImageViewBody", component: ImageFixture,
  parameters: { layout: "padded" }, decorators: [Story => <div className="max-w-md"><Story /></div>],
} satisfies Meta<typeof ImageFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Portrait: Story = { args: { aspectRatio: 0.75 } };
export const MissingResource: Story = { args: { missing: true } };
export const Narrow: Story = { decorators: [Story => <div className="w-60"><Story /></div>] };
