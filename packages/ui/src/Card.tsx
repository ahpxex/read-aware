import { type ElementType, type ComponentPropsWithRef } from "react";
import { cn } from "./lib/cn";

const variantClasses = {
  flat: "bg-paper",
  outlined: "border border-border bg-paper",
  filled: "bg-paper-warm",
} as const;

const paddingClasses = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
} as const;

type CardProps<T extends ElementType = "div"> = {
  as?: T;
  variant?: keyof typeof variantClasses;
  padding?: keyof typeof paddingClasses;
} & Omit<ComponentPropsWithRef<T>, "as" | "variant" | "padding">;

export function Card<T extends ElementType = "div">({
  as,
  variant = "outlined",
  padding = "md",
  className,
  ...props
}: CardProps<T>) {
  const Tag = (as || "div") as ElementType;
  return (
    <Tag
      className={cn(variantClasses[variant], paddingClasses[padding], className)}
      {...props}
    />
  );
}

function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4", className)} {...props} />;
}

function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm leading-relaxed text-fg-muted", className)} {...props} />;
}

function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-4 flex items-center gap-3 border-t border-border pt-4", className)}
      {...props}
    />
  );
}

Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;
