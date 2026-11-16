import { createElement, type ReactNode } from "react";
import { ToastProvider } from "@read-aware/ui";
import type { Preview } from "@storybook/react-vite";
import { initI18n } from "../src/i18n";
import { StoryStore } from "../src/story-support/atoms";
import { applyStoryDisplay, storyDisplayKey } from "../src/story-support/display";
import "../src/index.css";

const preview: Preview = {
  loaders: [
    async () => {
      await initI18n("en");
      return {};
    },
  ],
  parameters: {
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "todo",
    },
  },
  globalTypes: {
    theme: {
      description: "App theme",
      defaultValue: "light",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
    // Display mode, as Settings → Appearance sets it. E-ink pins the theme to
    // its own light token set, whatever the Theme toolbar says.
    eink: {
      description: "E-ink mode",
      defaultValue: "off",
      toolbar: {
        title: "E-ink",
        icon: "contrast",
        items: [
          { value: "off", title: "E-ink off" },
          { value: "on", title: "E-ink on" },
        ],
        dynamicTitle: true,
      },
    },
    // "Default" keeps honoring the OS reduce-motion preference, as the app's
    // `system` setting does; "Reduced" stops all motion.
    motion: {
      description: "Motion",
      defaultValue: "default",
      toolbar: {
        title: "Motion",
        icon: "lightning",
        items: [
          { value: "default", title: "Motion: default" },
          { value: "reduced", title: "Motion: reduced" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      applyStoryDisplay(context.globals);
      // A fresh jotai store per story mount: atom-reading components render
      // against defaults instead of state another story left behind, plus the
      // toolbar's display settings (see `story-support/display`). (Writes
      // that go through storage-backed atoms still hit this origin's
      // localStorage — isolation here is for in-memory atom state.)
      // The app mounts everything inside a ToastProvider (routes/__root), so
      // surfaces that raise toasts assume one is there. Without it here, any
      // story of such a surface fails to render at all.
      return createElement(
        StoryStore,
        { key: storyDisplayKey(context.globals), globals: context.globals },
        createElement(
          ToastProvider,
          null,
          createElement(
            "div",
            {
              // The app shell's canvas (App.tsx), NOT `bg-paper`. The paper
              // token is the :root/body background, but the shell covers it
              // everywhere — painting it here showed every story on a warm
              // ground the product never displays.
              className: "bg-[var(--ra-main-surface-color)] text-fg",
              style: { minHeight: "100vh", padding: "2rem" },
            },
            Story() as ReactNode,
          ),
        ),
      );
    },
  ],
};

export default preview;
