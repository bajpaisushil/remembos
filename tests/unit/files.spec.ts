import { expect, test } from "@playwright/test";
import { looksLikeText, stepText } from "@/lib/ingest/extract-file";
import { detectKind } from "@/lib/ingest/detect";

const IFC = `ISO-10303-21;
HEADER;FILE_NAME('tower.ifc','2026-03-01',('Ana'),(''),'','','');ENDSEC;
DATA;
#12= IFCPROJECT('2O2Fr$t4X7Zf8NOew3FLOH',#41,'Harbor Tower',$,$,$,$,(#20),#9);
#55= IFCWALLSTANDARDCASE('1kTvXnbbzCWw8lcMd1dR4o',#41,'Basic Wall:Exterior - Brick on CMU',$,$,#60,#70,'338492');
#80= IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('2HR'),$);
#81= IFCPROPERTYSINGLEVALUE('Acoustic',$,IFCLABEL('Bo\\X2\\00EE\\X0\\te'),$);
ENDSEC;END-ISO-10303-21;`;

test("IFC/STEP files: element types and quoted names become searchable text", () => {
  const text = stepText(IFC);
  expect(text).toContain("wallstandardcase");
  expect(text).toContain("Harbor Tower");
  expect(text).toContain("Basic Wall:Exterior - Brick on CMU");
  expect(text).toContain("FireRating");
  expect(text).toContain("2HR");
  expect(text).toContain("Boîte"); // \\X2\\ unicode escape decoded
  expect(text).not.toContain("2O2Fr$t4X7Zf8NOew3FLOH"); // GUID noise dropped
});

test("text sniffing: text yes, binary no", () => {
  expect(looksLikeText(new TextEncoder().encode("hello world\nline two"))).toBe(true);
  expect(looksLikeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))).toBe(false);
  expect(looksLikeText(new Uint8Array([]))).toBe(false);
});

test("every file type is accepted: unknown types become 'file' memories", () => {
  const f = (name: string, type = "") => new File(["x"], name, { type });
  expect(detectKind(f("model.ifc"))).toBe("file");
  expect(detectKind(f("project.rvt"))).toBe("file");
  expect(detectKind(f("archive.zip", "application/zip"))).toBe("file");
  expect(detectKind(f("report.docx"))).toBe("file");
  expect(detectKind(f("setup.exe", "application/x-msdownload"))).toBe("file");
  expect(detectKind(f("clip.avi", "video/x-msvideo"))).toBe("file");
  expect(detectKind(f("photo.png", "image/png"))).toBe("image");
  expect(detectKind(f("notes.txt", "text/plain"))).toBe("text");
});
