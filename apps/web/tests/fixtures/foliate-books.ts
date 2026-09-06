export const fb2Fixture = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info><genre>fiction</genre><author><first-name>Ada</first-name><last-name>Writer</last-name></author>
      <book-title>Test Book</book-title><lang>en</lang><date value="2024-01-02"/>
      <annotation><p>A <emphasis>description</emphasis>.</p></annotation><coverpage><image l:href="#cover.png"/></coverpage>
    </title-info><document-info><id>fb2-fixture</id><program-used>Fixture</program-used></document-info>
  </description>
  <body><section id="chapter-one"><title><p>Chapter One</p></title>
    <p>Hello <emphasis>world</emphasis>. <a type="note" l:href="#note-one">1</a></p>
    <image l:href="#cover.png" alt="Cover image" title="Image title"/>
    <table><tr><td colspan="2">Cell</td></tr></table>
    <poem><stanza><v>First line</v><v>Second line</v></stanza></poem>
    <section><title><p>Subchapter</p></title><p>Nested text.</p></section>
  </section><section id="chapter-two"><title><p>Chapter Two</p></title><p>Final text.</p></section></body>
  <body name="notes"><section id="note-one"><title><p>Note One</p></title><p>Footnote text.</p></section></body>
  <binary id="cover.png" content-type="image/png">iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==</binary>
</FictionBook>`;
