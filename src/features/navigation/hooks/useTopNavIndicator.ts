import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { topNavs, type TopNav } from "../../../state/ui";

export function useTopNavIndicator(activeTopNav: TopNav) {
  const [indicator, setIndicator] = useState({
    x: 0,
    width: 0,
    ready: false,
  });
  const navListRef = useRef<HTMLDivElement | null>(null);
  const navButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const updateIndicator = useCallback(() => {
    const navList = navListRef.current;
    const activeIndex = topNavs.findIndex((item) => item === activeTopNav);
    const activeButton = navButtonRefs.current[activeIndex];
    if (!navList || !activeButton) return;

    const listRect = navList.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    setIndicator({
      x: buttonRect.left - listRect.left,
      width: buttonRect.width,
      ready: true,
    });
  }, [activeTopNav]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useEffect(() => {
    const navList = navListRef.current;
    if (!navList) return;

    const observer = new ResizeObserver(() => {
      updateIndicator();
    });

    observer.observe(navList);
    navButtonRefs.current.forEach((button) => {
      if (button) observer.observe(button);
    });

    window.addEventListener("resize", updateIndicator);
    return () => {
      window.removeEventListener("resize", updateIndicator);
      observer.disconnect();
    };
  }, [updateIndicator]);

  return {
    indicator,
    navListRef,
    navButtonRefs,
  };
}
