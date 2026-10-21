import { buttonClassName } from "@read-aware/ui";

/** Shared hit target for the compact actions mounted in AppHeader. */
export const agentHeaderActionClass =
  "relative h-7 w-7 items-center justify-center text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg before:absolute before:-inset-1 before:content-['']";

/** Popover triggers in More use the same full-row button styling as actions. */
export const agentMenuActionClass = buttonClassName({
  variant: "ghost",
  size: "sm",
  className: "w-full justify-start rounded-md px-2 text-left",
});
