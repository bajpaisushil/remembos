import { expect, test } from "@playwright/test";
import { brokenIndicText, indicLangs, legacyFontText, pageNeedsReading } from "@/lib/ingest/script-check";

// What pdf.js returned for a real Hindi PDF made by Chrome: vowel signs and conjuncts are missing.
const BROKEN = " बजली  बल भुगतान रसीद\nउपभो ा का नाम: राहुल शमा । कुल रा श ₹2,340 जमा क  गई। अगली  त थ 15 माच  2026 ह ।";
const CORRECT = "बिजली बिल भुगतान रसीद\nउपभोक्ता का नाम: राहुल शर्मा। कुल राशि ₹2,340 जमा की गई। अगली तिथि 15 मार्च 2026 है।";
// Hindi typed in the old Kruti Dev font: stored as English letters.
const KRUTI =
  "jktLFkku ljdkj }kjk tkjh vkns'k ds vuqlkj lHkh foHkkxksa dks lwfpr fd;k tkrk gS fd vxyh cSBd esa mifLFkr gksuk vfuok;Z gSA bl laca/k esa fdlh izdkj dh =qfV ugha gksuh pkfg;s";
const ENGLISH =
  "The quarterly report shows revenue grew by twelve percent while costs stayed flat. Please review the attached PDF and the KPI dashboard before Friday's meeting with the board and the CFO.";

test("broken Hindi text layer is detected; correct Hindi is left alone", () => {
  expect(brokenIndicText(BROKEN)).toBe(true);
  expect(brokenIndicText(CORRECT)).toBe(false);
  expect(pageNeedsReading(BROKEN)).toEqual(["hin"]);
  expect(pageNeedsReading(CORRECT)).toBeNull();
});

test("NUL placeholders for letters the PDF couldn't encode mark a broken page, in any script", () => {
  // Exactly what pdf.js returned in the browser for "बिजली बिल भुगतान रसीद".
  const raw = "\u0000बजली \u0000बल भुगतान रसीद उपभो\u0000ा का नाम राहुल श\u0000मा";
  expect(pageNeedsReading(raw)).toEqual(["hin"]);
  expect(pageNeedsReading("Total \u0000 due \u0000 now \u0000 for the account holder named here")).toEqual([]);
});

test("old non-Unicode Hindi fonts (English letters standing in for Hindi) are detected", () => {
  expect(legacyFontText(KRUTI)).toBe(true);
  expect(pageNeedsReading(KRUTI)).toEqual(["hin"]);
});

test("ordinary English (with acronyms) never triggers re-reading", () => {
  expect(legacyFontText(ENGLISH)).toBe(false);
  expect(pageNeedsReading(ENGLISH)).toBeNull();
});

test("the script decides the reading language", () => {
  expect(indicLangs("আমার সোনার বাংলা আমি তোমায় ভালোবাসি")).toEqual(["ben"]);
  expect(indicLangs("வணக்கம் உலகம் இது ஒரு சோதனை")).toEqual(["tam"]);
  expect(indicLangs("Hello world")).toEqual([]);
});
