import { expect, test } from "bun:test";
import { getVariables, replace } from "../foliate-js/src/uri-template.js";
import { getFeed, getOpenSearch, getSearch, isOPDSCatalog, SYMBOL } from "../foliate-js/src/opds.js";
import { withDom } from "./helpers/foliate-dom.js";

test("URI templates preserve prefixes, fragments, empty and undefined values", () => {
  const vars = new Map([["text", "hello world"], ["path", "/a/b"], ["empty", ""], ["unicode", "😀中文"]]);
  expect(replace("{text:5}{/unicode:2}", vars)).toBe("hello/%F0%9F%98%80%E4%B8%AD");
  expect(replace("{+path}{#text,path}", vars)).toBe("/a/b#hello%20world,/a/b");
  expect(replace("{?empty,missing,text}", vars)).toBe("?empty=&text=hello%20world");
  expect(replace("{;empty,missing}{.text:5}", vars)).toBe(";empty.hello");
  expect([...getVariables("{+path}{?text:5,empty,missing*}")]).toEqual(["path", "text", "empty", "missing"]);
});

test("OPDS preserves publications, navigation, facets and content in a mixed group", () => withDom(window => {
  const doc = new window.DOMParser().parseFromString(`
    <feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
      <title>Catalog</title>
      <link rel="http://opds-spec.org/facet" href="/recent" opds:facetGroup="Sort" opds:activeFacet="true"/>
      <entry><title>Book</title><author><name>Writer</name></author><summary>Summary</summary>
        <link rel="http://opds-spec.org/acquisition" href="/book.epub" type="application/epub+zip"/>
        <link rel="http://opds-spec.org/image" href="/cover.jpg"/>
        <link rel="collection" href="/group" title="Group"/>
      </entry>
      <entry><title>More</title><summary>Browse</summary>
        <link href="/more" type='application/atom+xml;profile=opds-catalog'/>
        <link rel="collection" href="/group" title="Group"/>
      </entry>
    </feed>`, "application/xml");
  const feed = getFeed(doc);
  expect(feed.metadata.title).toBe("Catalog");
  const group = feed.groups[0];
  expect(group.publications?.[0].metadata.author[0].name).toBe("Writer");
  expect(group.publications?.[0].metadata[SYMBOL.CONTENT]).toEqual({ type: "text", value: "Summary" });
  expect(group.publications?.[0].images[0].href).toBe("/cover.jpg");
  expect(group.navigation?.[0].title).toBe("More");
  expect(group.navigation?.[0][SYMBOL.SUMMARY]).toBe("Browse");
  expect(feed.facets[0].metadata.title).toBe("Sort");
  expect(feed.facets[0].links[0].rel).toContain("self");
}));

test("catalog media types and URI-template searches", async () => {
  expect(isOPDSCatalog('Application/Atom+XML;profile="opds-catalog"')).toBe(true);
  expect(isOPDSCatalog("application/opds+json")).toBe(true);
  expect(isOPDSCatalog("application/atom+xml")).toBe(false);
  const search = await getSearch({ href: "/search{?query,count}" });
  expect(search.params).toEqual([{ name: "query" }, { name: "count" }]);
  expect(search.search(new Map([[null, new Map([["query", "a b"]])]]))).toBe("/search?query=a%20b");
  expect(search.search(new Map())).toBe("/search");
});

test("OpenSearch handles namespaces, defaults and required parameters", () => withDom(window => {
  const parse = (value: string) => new window.DOMParser().parseFromString(value, "application/xml");
  const search = getOpenSearch(parse(`<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/" xmlns:custom="urn:custom">
    <ShortName>Books</ShortName><Url type="application/atom+xml;profile=opds-catalog" indexOffset="1"
      template="/search?q={searchTerms}&amp;start={startIndex?}&amp;tag={custom:tag?}"/>
    </OpenSearchDescription>`));
  expect(search.metadata.title).toBe("Books");
  expect(search.params[0]).toEqual({ ns: null, name: "searchTerms", required: true, value: "" });
  expect(search.search(new Map([[null, new Map([["searchTerms", "two words"]])], ["urn:custom", new Map([["tag", "x/y"]])]])))
    .toBe("/search?q=two%20words&start=1&tag=x%2Fy");
  expect(() => getOpenSearch(parse("<OpenSearchDescription/>"))).toThrow("Url");
}));
