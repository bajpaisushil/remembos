import { expect, test } from "@playwright/test";
import { tokenize } from "@/lib/nlp/query";
import { normalizeTerm } from "@/lib/search/rank";

test("words with vowel signs stay whole (Hindi, Bengali, Tamil, Arabic)", () => {
  expect(tokenize("बिजली बिल भुगतान")).toEqual(["बिजली", "बिल", "भुगतान"]);
  expect(tokenize("আমার সোনার বাংলা")).toEqual(["আমার", "সোনার", "বাংলা"]);
  expect(tokenize("வணக்கம் உலகம்")).toEqual(["வணக்கம்", "உலகம்"]);
  expect(tokenize("مَرْحَبًا بالعالم")).toEqual(["مَرْحَبًا", "بالعالم"]);
});

test("accent folding is for Latin-style accents only", () => {
  expect(normalizeTerm("Café")).toBe("cafe");
  expect(normalizeTerm("naïve")).toBe("naive");
  expect(normalizeTerm("बिल")).not.toBe(normalizeTerm("बल"));
  expect(normalizeTerm("बिजली")).toBe("बिजली");
});
