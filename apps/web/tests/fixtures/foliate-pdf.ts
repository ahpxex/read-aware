import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";

export async function makePDFFixture(): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("PDF Engine Fixture");
  pdf.setAuthor("Test Writer");
  pdf.setCreationDate(new Date("2024-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2024-01-01T00:00:00Z"));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = [pdf.addPage([600, 800]), pdf.addPage([600, 800]), pdf.addPage([600, 800])];
  pages[1].drawText("Hello PDF world", { x: 30, y: 740, size: 24, font });
  pages[1].drawText("Go to final chapter", { x: 30, y: 700, size: 16, font });
  pages[1].drawRectangle({ x: 30, y: 400, width: 200, height: 200, color: rgb(0, 0, 0) });
  pages[2].drawText("Final chapter", { x: 30, y: 740, size: 24, font });
  const outline = pdf.context.obj({ Type: "Outlines", Count: 2 });
  const outlineRef = pdf.context.register(outline);
  const first = pdf.context.obj({ Title: PDFString.of("Chapter One"), Parent: outlineRef,
    Dest: [pages[1].ref, PDFName.of("Fit")],
  });
  const second = pdf.context.obj({ Title: PDFString.of("Final Chapter"), Parent: outlineRef,
    Dest: PDFString.of("final"),
  });
  const firstRef = pdf.context.register(first), secondRef = pdf.context.register(second);
  first.set(PDFName.of("Next"), secondRef);
  second.set(PDFName.of("Prev"), firstRef);
  outline.set(PDFName.of("First"), firstRef);
  outline.set(PDFName.of("Last"), secondRef);
  pdf.catalog.set(PDFName.of("Outlines"), outlineRef);
  pdf.catalog.set(PDFName.of("Names"), pdf.context.obj({ Dests: {
    Names: [PDFString.of("final"), { D: [pages[2].ref, PDFName.of("Fit")] }],
  } }));
  const link = pdf.context.register(pdf.context.obj({ Type: "Annot", Subtype: "Link",
    Rect: [30, 695, 190, 720], Border: [0, 0, 0], Dest: PDFString.of("final"),
  }));
  pages[1].node.addAnnot(link);
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}
