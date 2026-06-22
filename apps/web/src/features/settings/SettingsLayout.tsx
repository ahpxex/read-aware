import {
  ArrowLeft,
  BookOpen,
  Database,
  Info,
  Keyboard,
  Palette,
  SlidersHorizontal,
  Sparkle,
  type Icon,
} from "@phosphor-icons/react";
import { Link, Outlet, useLocation, useRouter } from "@tanstack/react-router";
import { IconButton, ScrollArea } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";

type SettingsSection = {
  to: string;
  label: string;
  icon: Icon;
};

const SECTIONS: SettingsSection[] = [
  { to: "/settings/general", label: "General", icon: SlidersHorizontal },
  { to: "/settings/appearance", label: "Appearance", icon: Palette },
  { to: "/settings/reading", label: "Reading", icon: BookOpen },
  { to: "/settings/ai", label: "AI", icon: Sparkle },
  { to: "/settings/shortcuts", label: "Shortcuts", icon: Keyboard },
  { to: "/settings/data", label: "Data & Sync", icon: Database },
  { to: "/settings/about", label: "About", icon: Info },
];

export function SettingsLayout() {
  const router = useRouter();
  const { pathname } = useLocation();

  const handleBack = () => {
    if (router.history.canGoBack()) {
      router.history.back();
    } else {
      void router.navigate({ to: "/" });
    }
  };

  return (
    <div className="flex h-screen flex-col bg-[var(--ra-main-surface-color)] text-fg">
      <header
        data-tauri-drag-region=""
        className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3"
        style={{ paddingLeft: "max(0.75rem, var(--ra-traffic-light-inset))" }}
      >
        <IconButton
          label="Back"
          size="sm"
          onClick={handleBack}
          icon={<ArrowLeft size={16} weight="regular" aria-hidden="true" />}
        />
        <span className="font-serif text-base font-medium text-fg">Settings</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Settings sections"
          className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/70 p-3"
        >
          {SECTIONS.map((section) => {
            const active = pathname === section.to;
            const SectionIcon = section.icon;
            return (
              <Link
                key={section.to}
                to={section.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-md px-3 py-2 font-sans text-sm transition-colors",
                  active
                    ? "font-medium text-fg"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-fg"
                  />
                )}
                <SectionIcon
                  size={16}
                  weight={active ? "fill" : "regular"}
                  aria-hidden="true"
                  className="shrink-0"
                />
                {section.label}
              </Link>
            );
          })}
        </nav>

        <ScrollArea className="min-h-0 flex-1">
          <Outlet />
        </ScrollArea>
      </div>
    </div>
  );
}
