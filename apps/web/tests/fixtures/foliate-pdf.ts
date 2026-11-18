import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";

/**
 * Three pages of `size` page units (portrait by default): the first a white
 * sheet the page paints itself, the second with text, a link and a filled
 * square — and then `more` pages, each with two typeset lines near its foot
 * ("Page N line one." / "It ends here.").
 */
export async function makePDFFixture(size: [number, number] = [600, 800], more = 0): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("PDF Engine Fixture");
  pdf.setAuthor("Test Writer");
  pdf.setCreationDate(new Date("2024-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2024-01-01T00:00:00Z"));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = [pdf.addPage(size), pdf.addPage(size), pdf.addPage(size)];
  // The first page paints its own white sheet edge to edge, as PDFs made
  // from ebooks and scans do; the others leave their paper to the viewer.
  pages[0].drawRectangle({ x: 0, y: 0, width: size[0], height: size[1], color: rgb(1, 1, 1) });
  // Laid out from the top edge, so the content sits the same on any page size.
  const top = size[1];
  pages[1].drawText("Hello PDF world", { x: 30, y: top - 60, size: 24, font });
  pages[1].drawText("Go to final chapter", { x: 30, y: top - 100, size: 16, font });
  pages[1].drawRectangle({ x: 30, y: top - 400, width: 200, height: 200, color: rgb(0, 0, 0) });
  pages[2].drawText("Final chapter", { x: 30, y: top - 60, size: 24, font });
  for (let i = 0; i < more; i++) {
    const page = pdf.addPage(size);
    page.drawText(`Page ${pages.length + i + 1} line one.`, { x: 30, y: 120, size: 16, font });
    page.drawText("It ends here.", { x: 30, y: 96, size: 16, font });
  }
  const outline = pdf.context.obj({ Type: "Outlines", Count: 2 });
  const outlineRef = pdf.context.register(outline);
  const first = pdf.context.obj({
    Title: PDFString.of("Chapter One"),
    Parent: outlineRef,
    Dest: [pages[1].ref, PDFName.of("Fit")],
  });
  const second = pdf.context.obj({
    Title: PDFString.of("Final Chapter"),
    Parent: outlineRef,
    Dest: PDFString.of("final"),
  });
  const firstRef = pdf.context.register(first),
    secondRef = pdf.context.register(second);
  first.set(PDFName.of("Next"), secondRef);
  second.set(PDFName.of("Prev"), firstRef);
  outline.set(PDFName.of("First"), firstRef);
  outline.set(PDFName.of("Last"), secondRef);
  pdf.catalog.set(PDFName.of("Outlines"), outlineRef);
  pdf.catalog.set(
    PDFName.of("Names"),
    pdf.context.obj({
      Dests: {
        Names: [PDFString.of("final"), { D: [pages[2].ref, PDFName.of("Fit")] }],
      },
    }),
  );
  const link = pdf.context.register(
    pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [30, top - 105, 190, top - 80],
      Border: [0, 0, 0],
      Dest: PDFString.of("final"),
    }),
  );
  pages[1].node.addAnnot(link);
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}
