import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  NavItem,
  Display,
  Eyebrow,
  Body,
  Caption,
  Divider,
  Toggle,
  Select,
  Radio,
  DefinitionList,
  Button,
  Stack,
} from "../components";

const navItems = ["shelf", "context", "settings"] as const;

function SettingsScreen() {
  const [fontSize, setFontSize] = useState("medium");
  const [lineSpacing, setLineSpacing] = useState("comfortable");
  const [autoContext, setAutoContext] = useState(true);
  const [showDefinitions, setShowDefinitions] = useState(true);
  const [contextDepth, setContextDepth] = useState("standard");
  const [theme, setTheme] = useState("light");

  return (
    <main className="min-h-screen bg-stone-100 text-stone-950">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-6 sm:px-10 sm:py-8 lg:px-14">
        <header className="border-b border-border pb-4">
          <nav aria-label="Primary" className="flex flex-wrap gap-6 sm:gap-8">
            {navItems.map((item) => (
              <NavItem key={item} active={item === "settings"}>{item}</NavItem>
            ))}
          </nav>
        </header>

        <div className="max-w-2xl py-12 sm:py-16">
          <Display as="h1" size="5xl">Settings</Display>
          <Body className="mt-3 text-stone-600">
            Adjust how RadAware looks and behaves.
          </Body>

          {/* Reading */}
          <section className="mt-12">
            <Eyebrow>Reading</Eyebrow>
            <Stack gap="lg" className="mt-6">
              <Select
                label="Font size"
                value={fontSize}
                onChange={setFontSize}
                options={[
                  { label: "Small", value: "small" },
                  { label: "Medium", value: "medium" },
                  { label: "Large", value: "large" },
                ]}
              />
              <Select
                label="Line spacing"
                value={lineSpacing}
                onChange={setLineSpacing}
                options={[
                  { label: "Compact", value: "compact" },
                  { label: "Comfortable", value: "comfortable" },
                  { label: "Relaxed", value: "relaxed" },
                ]}
              />
            </Stack>
          </section>

          <Divider className="my-10" />

          {/* Display */}
          <section>
            <Eyebrow>Display</Eyebrow>
            <Stack gap="lg" className="mt-6">
              <fieldset>
                <Caption as="legend" className="mb-3 text-stone-600">Theme</Caption>
                <Stack gap="sm">
                  <Radio
                    label="Light"
                    name="theme"
                    value="light"
                    checked={theme === "light"}
                    onChange={() => setTheme("light")}
                  />
                  <Radio
                    label="Warm"
                    description="Paper-toned canvas"
                    name="theme"
                    value="warm"
                    checked={theme === "warm"}
                    onChange={() => setTheme("warm")}
                  />
                  <Radio
                    label="Dark"
                    name="theme"
                    value="dark"
                    checked={theme === "dark"}
                    onChange={() => setTheme("dark")}
                  />
                </Stack>
              </fieldset>
            </Stack>
          </section>

          <Divider className="my-10" />

          {/* AI Context */}
          <section>
            <Eyebrow>AI Context</Eyebrow>
            <Stack gap="lg" className="mt-6">
              <Toggle
                label="Auto-generate context"
                checked={autoContext}
                onChange={setAutoContext}
              />
              <Toggle
                label="Show inline definitions"
                checked={showDefinitions}
                onChange={setShowDefinitions}
              />
              <Select
                label="Context depth"
                value={contextDepth}
                onChange={setContextDepth}
                options={[
                  { label: "Brief", value: "brief" },
                  { label: "Standard", value: "standard" },
                  { label: "Detailed", value: "detailed" },
                ]}
              />
            </Stack>
          </section>

          <Divider className="my-10" />

          {/* Account */}
          <section>
            <Eyebrow>Account</Eyebrow>
            <DefinitionList
              className="mt-6"
              items={[
                { label: "Email", value: "reader@example.com" },
                { label: "Plan", value: "Personal" },
                { label: "Member since", value: "January 2026" },
              ]}
            />
            <Stack direction="horizontal" gap="md" className="mt-8">
              <Button variant="outline" size="sm">Export data</Button>
              <Button variant="danger" size="sm">Delete account</Button>
            </Stack>
          </section>
        </div>
      </div>
    </main>
  );
}

const meta: Meta = {
  title: "Interface/Settings",
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <SettingsScreen />,
};
