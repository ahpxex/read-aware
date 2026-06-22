import type { ReactNode } from "react";
import { Stack } from "@read-aware/ui";

type SettingsPageProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
};

/** Standard frame for a settings section: serif title, lead description, body stack. */
export function SettingsPage({ title, description, children }: SettingsPageProps) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-9 sm:px-10">
      <header className="mb-7">
        <h1 className="font-serif text-2xl text-fg">{title}</h1>
        {description && (
          <p className="mt-1.5 font-sans text-sm leading-6 text-fg-muted">{description}</p>
        )}
      </header>
      <Stack gap="xl">{children}</Stack>
    </div>
  );
}
