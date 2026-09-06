import { expect, test } from "bun:test";
import { TTS } from "../foliate-js/src/tts.js";
import { textWalker } from "../foliate-js/src/text-walker.js";
import { withDom } from "./helpers/foliate-dom.js";

const ssmlNS = "http://www.w3.org/2001/10/synthesis";
const xmlNS = "http://www.w3.org/XML/1998/namespace";

test("TTS preserves inline text, marks and paragraph navigation", () => withDom(window => {
  const doc = window.document;
  doc.body.innerHTML = '<p>Hello <em>world</em>.</p><p>Next paragraph.</p>';
  const highlights: string[] = [];
  const tts = new TTS(doc, textWalker, range => highlights.push(range.toString()));
  const parse = (value: string | undefined) => new window.DOMParser().parseFromString(value ?? "", "application/xml");
  const first = parse(tts.start());
  expect(first.documentElement.textContent).toBe("Hello world.");
  expect(Array.from(first.getElementsByTagNameNS(ssmlNS, "mark"), el => el.getAttribute("name"))).toEqual(["0", "1"]);
  tts.setMark("1");
  expect(highlights).toEqual(["world"]);
  expect(parse(tts.resume()).documentElement.textContent).toBe("world.");
  expect(parse(tts.next(true)).documentElement.textContent).toBe("Next paragraph.");
  expect(highlights.at(-1)).toBe("Next paragraph.");
  expect(tts.next()).toBeUndefined();
  expect(parse(tts.prev()).documentElement.textContent).toBe("Hello world.");
  expect(parse(tts.start()).documentElement.textContent).toBe("Hello world.");
}));

test("TTS inherits language and phonetic alphabet without confusing them", () => withDom(window => {
  const doc = window.document;
  doc.body.innerHTML = '<p lang="en"><span>hello</span> <span>world</span></p>';
  const paragraph = doc.querySelector("p")!;
  paragraph.setAttributeNS(ssmlNS, "ssml:alphabet", "ipa");
  paragraph.querySelector("span")!.setAttributeNS(ssmlNS, "ssml:ph", "həˈləʊ");
  const tts = new TTS(doc, textWalker, () => {});
  const output = new window.DOMParser().parseFromString(tts.start() ?? "", "application/xml");
  const language = output.getElementsByTagNameNS(ssmlNS, "lang")[0] ?? output.documentElement;
  expect(language.getAttributeNS(xmlNS, "lang")).toBe("en");
  expect(output.getElementsByTagNameNS(ssmlNS, "phoneme")[0]?.getAttribute("alphabet")).toBe("ipa");
  expect(output.documentElement.textContent).toBe("hello world");
}));

test("TTS maps words spanning nodes and sentences to the original document", () => withDom(window => {
  const doc = window.document;
  doc.body.innerHTML = '<p>hel<em>lo</em> world. Another sentence!</p>';
  const highlights: string[] = [];
  const words = new TTS(doc, textWalker, range => highlights.push(range.toString()));
  words.start();
  words.setMark("0");
  expect(highlights.at(-1)).toBe("hello");
  const sentences = new TTS(doc, textWalker, range => highlights.push(range.toString()), "sentence");
  sentences.start();
  sentences.setMark("1");
  expect(highlights.at(-1)).toBe("Another sentence!");
}));

test("TTS starts at a requested range and handles an empty document", () => withDom(window => {
  const doc = window.document;
  expect(new TTS(doc, textWalker, () => {}).start()).toBeUndefined();
  doc.body.innerHTML = '<p>First paragraph.</p><p>Second target word.</p>';
  const text = doc.querySelectorAll("p")[1].firstChild!;
  const range = doc.createRange();
  range.setStart(text, 7);
  range.collapse(true);
  const tts = new TTS(doc, textWalker, () => {});
  const output = new window.DOMParser().parseFromString(tts.from(range) ?? "", "application/xml");
  expect(output.documentElement.textContent).toBe("target word.");
}));
