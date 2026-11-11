import { useState, type ComponentProps, type MouseEvent } from "react";
import type { ExtraProps } from "streamdown";
import { cn } from "@read-aware/ui/cn";
import { preferredScrollBehavior } from "../../settings";
import { createLogger } from "../../../platform/logger";
import { MARKDOWN_REPLY_CLASS, fragmentTargetId, isFragmentHref } from "../lib/markdown-fragment";
import { MarkdownLinkDialog } from "./MarkdownLinkDialog";

const log = createLogger("chat-markdown");

/** Streamdown's placeholder href for a link whose URL has not streamed in yet. */
const INCOMPLETE_LINK_HREF = "streamdown:incomplete-link";
const LINK_CLASS = "wrap-anywhere font-medium text-primary underline";

type MarkdownLinkProps = ComponentProps<"a"> & ExtraProps;

/**
 * Every link in a rendered reply. Replaces Streamdown's built-in link, which
 * sends in-reply fragments (footnote citations) to the external-link
 * confirmation and drops the `id` that footnote back-links target. External
 * URLs still confirm before leaving the app; fragments move within the reply.
 */
export function MarkdownLink({
  node: _node,
  href,
  target: _target,
  rel: _rel,
  className,
  ...props
}: MarkdownLinkProps) {
  if (!href || href === INCOMPLETE_LINK_HREF)
    return <span {...props} data-incomplete={href ? true : undefined} className={cn(LINK_CLASS, className)} />;
  if (isFragmentHref(href)) return <FragmentLink {...props} href={href} className={cn(LINK_CLASS, className)} />;
  return <ExternalLink {...props} href={href} className={cn(LINK_CLASS, className)} />;
}

function FragmentLink({ href, ...props }: ComponentProps<"a"> & { href: string }) {
  function jump(event: MouseEvent<HTMLAnchorElement>) {
    // Changing location.hash would reach the app router; scroll in place instead.
    event.preventDefault();
    const reply = event.currentTarget.closest(`.${MARKDOWN_REPLY_CLASS}`);
    const target = reply?.querySelector(`[id="${CSS.escape(fragmentTargetId(href))}"]`);
    if (!target) {
      // A model-written `#anchor` with nothing to land on in its own reply.
      log.warn("Markdown fragment link has no target in its reply");
      return;
    }
    // Keyboard users continue from the landing spot: the footnote's first link
    // (its source), or the citation marker itself when returning.
    const focusable = target instanceof HTMLAnchorElement ? target : target.querySelector("a[href]");
    if (focusable instanceof HTMLElement) focusable.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center", behavior: preferredScrollBehavior() });
  }
  return <a {...props} href={href} onClick={jump} />;
}

function ExternalLink({ href, ...props }: ComponentProps<"a"> & { href: string }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <a
        {...props}
        href={href}
        onClick={(event) => {
          event.preventDefault();
          setConfirming(true);
        }}
      />
      <MarkdownLinkDialog url={href} isOpen={confirming} onClose={() => setConfirming(false)} />
    </>
  );
}
