import { cn } from "./lib/cn";

type BreadcrumbItem = {
  label: string;
  href?: string;
  onClick?: () => void;
};

type BreadcrumbProps = {
  items: BreadcrumbItem[];
  separator?: string;
  className?: string;
};

export function Breadcrumb({
  items,
  separator = "/",
  className,
}: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex items-center gap-1.5 font-sans text-sm">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden className="text-stone-400">
                  {separator}
                </span>
              )}
              {isLast ? (
                <span
                  aria-current="page"
                  className="text-stone-950 font-medium"
                >
                  {item.label}
                </span>
              ) : item.href ? (
                <a
                  href={item.href}
                  className={cn(
                    "text-stone-500 transition-colors hover:text-stone-950",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
                  )}
                >
                  {item.label}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={item.onClick}
                  className={cn(
                    "bg-transparent p-0 text-stone-500 transition-colors hover:text-stone-950",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
                  )}
                >
                  {item.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
