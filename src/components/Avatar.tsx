import { cn } from "./lib/cn";

const sizeClasses = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-lg",
} as const;

type AvatarProps = {
  src?: string;
  alt?: string;
  initials?: string;
  size?: keyof typeof sizeClasses;
  className?: string;
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Avatar({
  src,
  alt,
  initials,
  size = "md",
  className,
}: AvatarProps) {
  const fallback = initials ?? (alt ? getInitials(alt) : "?");

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-200 font-sans font-medium text-stone-600",
        sizeClasses[size],
        className,
      )}
      role="img"
      aria-label={alt ?? initials ?? "Avatar"}
    >
      {src ? (
        <img
          src={src}
          alt={alt ?? ""}
          className="h-full w-full object-cover"
        />
      ) : (
        fallback
      )}
    </span>
  );
}
