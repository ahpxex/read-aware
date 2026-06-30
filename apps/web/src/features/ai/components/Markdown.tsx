import { Streamdown } from "streamdown";
import { cn } from "@read-aware/ui/cn";

/**
 * Renders assistant replies as Markdown via Streamdown (handles partial/unclosed
 * Markdown mid-stream out of the box). Kept deliberately quiet for the reader's
 * editorial surface: no copy/download chrome, no code line numbers. Streamdown's
 * shadcn-style color utilities are remapped onto our palette in `index.css`, so
 * it inherits the paper theme and dark mode automatically.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <Streamdown
      controls={false}
      lineNumbers={false}
      className={cn("ra-chat-markdown", className)}
    >
      {children}
    </Streamdown>
  );
}
