import { Link } from "@tanstack/react-router";
import type { Components } from "react-markdown";

export const markdownElements: Components = {
  a({ href = "", children }) {
    if (href.startsWith("/")) {
      return <Link to={href as never}>{children}</Link>;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto">
        <table>{children}</table>
      </div>
    );
  },
};
