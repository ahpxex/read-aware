import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { MARKDOWN_REPLY_CLASS, fragmentTargetId, isFragmentHref } from "../lib/markdown-fragment";
import { Markdown } from "./Markdown";

// Contract with the installed Streamdown: the ids it renders are what
// fragmentTargetId resolves to. A Streamdown upgrade that changes id
// prefixing (2.6 dropped a double prefix) fails here instead of silently
// breaking footnote jumps.
test("every footnote citation and back-link in a rendered reply resolves to a target inside it", () => {
  const markup = renderToStaticMarkup(
    <Markdown>{"Claim[^1] and 中文[^注].\n\n[^1]: Source one.\n[^注]: 来源。"}</Markdown>,
  );
  const { document } = new JSDOM(markup).window;
  const reply = document.querySelector(`.${MARKDOWN_REPLY_CLASS}`);
  expect(reply).not.toBeNull();
  const hrefs = [...reply!.querySelectorAll("a[href]")]
    .map((link) => link.getAttribute("href")!)
    .filter(isFragmentHref);
  // Two citations and their two back-links.
  expect(hrefs).toHaveLength(4);
  for (const href of hrefs) {
    expect({ href, found: reply!.querySelector(`[id="${fragmentTargetId(href)}"]`) !== null }).toEqual({
      href,
      found: true,
    });
  }
});
