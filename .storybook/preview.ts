import type { Preview } from "@storybook/react-vite";
import "../src/index.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "paper",
      values: [
        { name: "paper", value: "#f5f1e8" },
        { name: "white", value: "#ffffff" },
        { name: "dark", value: "#1c1917" },
      ],
    },
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
};

export default preview;
