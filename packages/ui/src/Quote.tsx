import { type ReactNode } from "react";
import { cn } from "./lib/cn";

type QuoteProps = {
  children: ReactNode;
  attribution?: ReactNode;
  className?: string;
};

export function Quote({ children, attribution, className }: QuoteProps) {
  return (
    <figure className={cn("border-l-2 border-border pl-4", className)}>
      <blockquote className="font-serif text-sm italic leading-7 text-fg-muted">
        {children}
      </blockquote>
      {attribution && (
        <figcaption className="mt-2 font-sans text-caption text-fg-subtle">
          {attribution}
        </figcaption>
      )}
    </figure>
  );
}
