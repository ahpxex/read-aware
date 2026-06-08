import { forwardRef, type ComponentPropsWithoutRef, type Ref } from "react";
import { cn } from "./lib/cn";

type ScrollableNodeProps = Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  ref?: Ref<HTMLDivElement>;
};

type ScrollAreaProps = ComponentPropsWithoutRef<"div"> & {
  scrollableNodeProps?: ScrollableNodeProps;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  function ScrollArea({ className, children, scrollableNodeProps, ...props }, ref) {
    const {
      className: scrollableClassName,
      ref: scrollableRef,
      ...scrollableProps
    } = scrollableNodeProps ?? {};

    return (
      <div
        ref={(node) => {
          assignRef(ref, node);
          assignRef(scrollableRef, node);
        }}
        className={cn("ra-scrollarea overflow-auto", className, scrollableClassName)}
        {...props}
        {...scrollableProps}
      >
        {children}
      </div>
    );
  },
);

ScrollArea.displayName = "ScrollArea";
