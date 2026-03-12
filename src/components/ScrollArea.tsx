import { forwardRef, type ComponentPropsWithoutRef } from "react";
import SimpleBar from "simplebar-react";
import type SimpleBarCore from "simplebar-core";
import { cn } from "./lib/cn";

type ScrollAreaProps = Omit<ComponentPropsWithoutRef<typeof SimpleBar>, "autoHide">;

export const ScrollArea = forwardRef<SimpleBarCore | null, ScrollAreaProps>(
  function ScrollArea({ className, children, ...props }, ref) {
    return (
      <SimpleBar
        ref={ref}
        autoHide={false}
        className={cn("ra-scrollarea", className)}
        {...props}
      >
        {children}
      </SimpleBar>
    );
  },
);

ScrollArea.displayName = "ScrollArea";
