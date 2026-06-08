import { useId, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { useLocalAtom } from "./lib/useLocalAtom";
import { cn } from "./lib/cn";

type AccordionItemData = {
  label: string;
  content: ReactNode;
};

type AccordionProps = {
  items: AccordionItemData[];
  type?: "single" | "multiple";
  defaultOpen?: number[];
  className?: string;
};

export function Accordion({
  items,
  type = "single",
  defaultOpen = [],
  className,
}: AccordionProps) {
  const [openIndices, setOpenIndices] = useLocalAtom<Set<number>>(
    new Set(defaultOpen),
  );

  function toggle(index: number) {
    setOpenIndices((prev) => {
      const next = new Set(type === "multiple" ? prev : []);
      if (prev.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  return (
    <div className={cn("divide-y divide-border", className)}>
      {items.map((item, i) => (
        <AccordionItem
          key={item.label}
          label={item.label}
          content={item.content}
          open={openIndices.has(i)}
          onToggle={() => toggle(i)}
        />
      ))}
    </div>
  );
}

function AccordionItem({
  label,
  content,
  open,
  onToggle,
}: {
  label: string;
  content: ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  const panelId = `${id}-panel`;
  const triggerId = `${id}-trigger`;

  return (
    <div>
      <h3>
        <button
          id={triggerId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-center justify-between py-4 text-left font-sans text-sm font-medium text-stone-950 transition-colors hover:text-stone-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950"
        >
          {label}
          <CaretDown
            size={16}
            weight="bold"
            className={cn(
              "shrink-0 text-stone-400 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        aria-hidden={!open}
        className={cn(
          "overflow-hidden transition-[grid-template-rows] duration-200",
          "grid",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0">
          <div className={cn("text-sm leading-relaxed text-stone-700", open && "pb-4")}>
            {content}
          </div>
        </div>
      </div>
    </div>
  );
}
