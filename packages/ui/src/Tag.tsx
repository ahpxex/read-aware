import { type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/cn";

type TagProps = {
  children: ReactNode;
  variant?: "default" | "outline";
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
};

export function Tag({ children, variant = "default", onRemove, removeLabel, className }: TagProps) {
  const { t } = useTranslation("ui");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-sans text-caption",
        variant === "default" && "bg-fill px-2 py-0.5 text-fg-muted",
        variant === "outline" && "border border-border px-2 py-0.5 text-fg-muted",
        className,
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? t("remove", { name: typeof children === "string" ? children : "" })}
          className="ml-0.5 text-fg-subtle hover:text-fg-muted"
        >
          <X size={12} weight="bold" />
        </button>
      )}
    </span>
  );
}
