import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { MARKDOWN_REPLY_CLASS, fragmentTargetId, isFragmentHref } from "../lib/markdown-fragment";
import { Markdown } from "./Markdown";

// Contract with the installed Streamdown: the ids it renders are what
// fragmentTargetId resolves to, and model-written HTML cannot claim bare ids
// or names. A Streamdown upgrade that changes id prefixing (2.6 set the
// sanitize clobberPrefix to "") fails here instead of silently breaking
// footnote jumps or reopening DOM clobbering.
test("model-written HTML ids and names are clobber-prefixed", () => {
  const markup = renderToStaticMarkup(
    <Markdown>{'Raw <a id="root" name="config" href="#x">link</a> <span id="app">s</span>'}</Markdown>,
  );
  const { document } = new JSDOM(markup).window;
  expect(document.querySelector("#root, #app, [name='config']")).toBeNull();
  expect(document.getElementById("user-content-root")).not.toBeNull();
  expect(document.getElementById("user-content-app")).not.toBeNull();
  expect(document.querySelector("[name='user-content-config']")).not.toBeNull();
});

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
