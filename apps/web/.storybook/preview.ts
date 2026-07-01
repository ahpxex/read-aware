import { createElement, type ReactNode } from "react";
import type { Preview } from "@storybook/react-vite";
import { initI18n } from "../src/i18n";
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
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === "dark" ? "dark" : "light";
      if (typeof document !== "undefined") {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
      }
      return createElement(
        "div",
        {
          className: "bg-paper text-fg",
          style: { minHeight: "100vh", padding: "2rem" },
        },
        Story() as ReactNode,
      );
    },
  ],
};

export default preview;
