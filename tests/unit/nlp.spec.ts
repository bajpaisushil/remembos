import { expect, test } from "@playwright/test";
import { chunkText, deriveSummary, deriveTitle, PAGE_SEPARATOR } from "@/lib/nlp/chunk";
import { extractEntities, normalizeEntity } from "@/lib/nlp/entities";
import { parseQuery, tokenize } from "@/lib/nlp/query";
import { LIMITS } from "@/lib/config";
import type { EntityType, ExtractedEntity } from "@/lib/types";

// Fixed reference: Wednesday 11 November 2026, 15:30 local time.
const NOW = new Date(2026, 10, 11, 15, 30);
const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

function ents(text: string, type?: EntityType, opts?: Parameters<typeof extractEntities>[1]): ExtractedEntity[] {
  const all = extractEntities(text, { now: NOW, ...opts });
  return type ? all.filter((e) => e.type === type) : all;
}
const norms = (text: string, type: EntityType) => ents(text, type).map((e) => e.normalized);
const values = (text: string, type: EntityType) => ents(text, type).map((e) => e.value);

// ───────────────────────────── entities: phones ─────────────────────────────

test.describe("extractEntities — phones", () => {
  test("international and local formats are found and normalised", () => {
    const cases: [string, string, string][] = [
      ["Call +1 (415) 555-0134 today", "+1 (415) 555-0134", "+14155550134"],
      ["Office: 415.555.0134.", "415.555.0134", "4155550134"],
      ["London +44 20 7946 0958", "+44 20 7946 0958", "+442079460958"],
      ["Mumbai +91 98765 43210", "+91 98765 43210", "+919876543210"],
      ["Alt number 98765-43210", "98765-43210", "9876543210"],
      ["Toll free 1-800-555-0199", "1-800-555-0199", "18005550199"],
      ["Mobile: 9876543210", "9876543210", "9876543210"],
      ["WhatsApp +919876543210", "+919876543210", "+919876543210"],
      ["Dial 00 44 20 7946 0958 from abroad", "00 44 20 7946 0958", "+442079460958"],
      ["Paris +33 1 23 45 67 89", "+33 1 23 45 67 89", "+33123456789"],
      ["Desk (020) 7946 0958", "(020) 7946 0958", "02079460958"],
      ["Local 555-0134", "555-0134", "5550134"],
    ];
    for (const [text, value, normalized] of cases) {
      const phones = ents(text, "phone");
      expect(phones, text).toHaveLength(1);
      expect(phones[0].value, text).toBe(value);
      expect(phones[0].normalized, text).toBe(normalized);
      expect(phones[0].index, text).toBe(text.indexOf(value));
    }
  });

  test("normalized keeps only digits and a leading +", () => {
    for (const e of ents("+1 (415) 555-0134, 415.555.0134 and +44 20 7946 0958", "phone")) {
      expect(e.normalized).toMatch(/^\+?\d{7,15}$/);
    }
  });

  test("same number written twice is deduped with a count", () => {
    const phones = ents("Call 415-555-0134. Again: 415.555.0134 or 415 555 0134", "phone");
    expect(phones).toHaveLength(1);
    expect(phones[0].count).toBe(3);
    expect(phones[0].value).toBe("415-555-0134");
  });

  test("rejects dates, years, times, amounts, ids and card numbers", () => {
    const negatives = [
      "Due 2026-03-14 and 14/03/2026 and 03.14.2026",
      "Between 2019-2024 the team grew; in 2024 and 2025 too.",
      "Slots 10:30-11:45 and 10.30-11.45 and 09:00",
      "Paid $1,234,567 and ₹98,76,543 and Rs. 9876543210 and 1200000 USD",
      "Order #4058123456 shipped",
      "Order No: 4058123456",
      "Order number 9876543210",
      "Invoice INV-2024-00123",
      "Tracking id 1234567890123456789",
      "Card 4111 1111 1111 1111 exp 12/27",
      "Account 1234 5678 9012",
      "Timestamp 1678901234",
      "ZIP 94105-1234",
      "SSN 123-45-6789",
      "Server at 192.168.100.200",
      "Population 1 400 000 000 people",
      "Total 1234567.89",
      "Ref: 555-0134",
      "ISBN 978-3-16-148410-0",
      "Version 1.12.4 released",
      "Scores 12 15 18 22 30",
      "Coordinates 37.7749, -122.4194",
      "All zeros 0000000000",
    ];
    for (const text of negatives) expect(norms(text, "phone"), text).toEqual([]);
  });

  test("phone cue words rescue unusual formatting; id cues veto", () => {
    expect(norms("Phone: 07946 095800", "phone")).toEqual(["07946095800"]);
    expect(norms("tel 22 4567 8901", "phone")).toEqual(["2245678901"]);
    expect(norms("Customer ID 4155550134", "phone")).toEqual([]);
  });
});

// ───────────────────────────── entities: emails & urls ─────────────────────────────

test.describe("extractEntities — emails and links", () => {
  test("emails are found, lower-cased and stripped of punctuation", () => {
    const text = "Write to Sarah.Chen@Acme.COM. Or mailto:billing@globex.co.uk, or ops+alerts@my-company.io!";
    expect(ents(text, "email").map((e) => [e.value, e.normalized])).toEqual([
      ["Sarah.Chen@Acme.COM", "sarah.chen@acme.com"],
      ["billing@globex.co.uk", "billing@globex.co.uk"],
      ["ops+alerts@my-company.io", "ops+alerts@my-company.io"],
    ]);
  });

  test("handles and broken addresses are not emails", () => {
    expect(norms("Follow @sarah on social, or user@localhost, or a@b", "email")).toEqual([]);
  });

  test("the domain of an email is not also a link", () => {
    expect(norms("sarah@acme.com", "url")).toEqual([]);
  });

  test("links with scheme, www and bare domains", () => {
    const text =
      "Docs: https://www.Acme.com/Pricing/?utm_source=news&plan=pro#faq. Also see www.example.org, " +
      "notion.so/acme/roadmap and github.com/vercel/next.js/ (mirror http://acme.com/pricing).";
    const urls = ents(text, "url");
    expect(urls.map((u) => u.value)).toEqual([
      "https://www.Acme.com/Pricing/?utm_source=news&plan=pro#faq",
      "www.example.org",
      "notion.so/acme/roadmap",
      "github.com/vercel/next.js/",
      "http://acme.com/pricing",
    ]);
    expect(urls.map((u) => u.normalized)).toEqual([
      "acme.com/Pricing/?plan=pro#faq",
      "example.org",
      "notion.so/acme/roadmap",
      "github.com/vercel/next.js",
      "acme.com/pricing",
    ]);
  });

  test("trailing punctuation is stripped but balanced brackets kept", () => {
    expect(values("See [docs](https://acme.com/docs).", "url")).toEqual(["https://acme.com/docs"]);
    expect(values("(https://en.wikipedia.org/wiki/Mercury_(planet))", "url")).toEqual([
      "https://en.wikipedia.org/wiki/Mercury_(planet)",
    ]);
    expect(values('"https://acme.com/a?b=1",', "url")).toEqual(["https://acme.com/a?b=1"]);
  });

  test("variants of the same link dedupe", () => {
    const urls = ents("https://acme.com/ and http://www.acme.com and acme.com", "url");
    expect(urls).toHaveLength(1);
    expect(urls[0].count).toBe(3);
    expect(urls[0].normalized).toBe("acme.com");
  });

  test("file names, abbreviations and typos are not links", () => {
    expect(
      norms("Open report.pdf, index.js, notes.txt, README.md, setup.py, e.g. this, U.S.A. and done.So tired", "url"),
    ).toEqual([]);
  });
});

// ───────────────────────────── entities: money ─────────────────────────────

test.describe("extractEntities — money", () => {
  test("currency formats are normalised to CODE amount", () => {
    const cases: [string, string, string][] = [
      ["Paid $1,234.56 today", "$1,234.56", "USD 1234.56"],
      ["Ticket €50", "€50", "EUR 50"],
      ["Book £9.99", "£9.99", "GBP 9.99"],
      ["Lunch ₹1,200", "₹1,200", "INR 1200"],
      ["Auto Rs. 500", "Rs. 500", "INR 500"],
      ["Fee INR 2,000", "INR 2,000", "INR 2000"],
      ["Cost 1200 USD", "1200 USD", "USD 1200"],
      ["Cost USD 1,200", "USD 1,200", "USD 1200"],
      ["Gave 50 dollars", "50 dollars", "USD 50"],
      ["Raised $2.4M seed", "$2.4M", "USD 2400000"],
      ["Salary ₹12 lakh", "₹12 lakh", "INR 1200000"],
      ["Rent €1.234,56", "€1.234,56", "EUR 1234.56"],
      ["Coffee 3,50 €", "3,50 €", "EUR 3.50"],
      ["Deposit ₹1,20,000", "₹1,20,000", "INR 120000"],
      ["Fare US$45", "US$45", "USD 45"],
      ["Price $5.00", "$5.00", "USD 5"],
    ];
    for (const [text, value, normalized] of cases) {
      const money = ents(text, "money");
      expect(money, text).toHaveLength(1);
      expect(money[0].value, text).toBe(value);
      expect(money[0].normalized, text).toBe(normalized);
    }
  });

  test("bare k/M amounts need a money cue nearby", () => {
    expect(ents("Budget: 3.5k for the offsite", "money").map((e) => [e.value, e.normalized])).toEqual([["3.5k", "3500"]]);
    expect(norms("Walked 10k steps and ran a 5k", "money")).toEqual([]);
    expect(norms("The video got 2.4M views", "money")).toEqual([]);
  });

  test("plain numbers, weights and programming versions are not money", () => {
    expect(norms("We had 1200 visitors, lost 10 pounds and upgraded to PHP 8.2", "money")).toEqual([]);
  });

  test("the same amount written differently dedupes", () => {
    const money = ents("Total $1,200. Confirmed USD 1200 and 1200 USD.", "money");
    expect(money).toHaveLength(1);
    expect(money[0].count).toBe(3);
  });
});

// ───────────────────────────── entities: dates ─────────────────────────────

test.describe("extractEntities — dates", () => {
  test("common formats normalise to ISO", () => {
    const cases: [string, string, string][] = [
      ["Due 2026-03-14.", "2026-03-14", "2026-03-14"],
      ["Due 14/03/2026", "14/03/2026", "2026-03-14"],
      ["Due 03/14/2026", "03/14/2026", "2026-03-14"],
      ["Due March 14, 2026", "March 14, 2026", "2026-03-14"],
      ["Due 14 Mar 2026", "14 Mar 2026", "2026-03-14"],
      ["Due 3rd of September 2025", "3rd of September 2025", "2025-09-03"],
      ["Statement 14-Mar-26", "14-Mar-26", "2026-03-14"],
      ["Due 14.03.2026", "14.03.2026", "2026-03-14"],
      ["Launch in March 2026", "March 2026", "2026-03"],
      ["Since Sept 2025", "Sept 2025", "2025-09"],
      ["Created 2026-03-14T10:30:00Z", "2026-03-14", "2026-03-14"],
    ];
    for (const [text, value, normalized] of cases) {
      const dates = ents(text, "date");
      expect(dates, text).toHaveLength(1);
      expect(dates[0].value, text).toBe(value);
      expect(dates[0].normalized, text).toBe(normalized);
    }
  });

  test("year-less dates use the reference year, or a year mentioned nearby", () => {
    expect(norms("Party on Sept 3rd", "date")).toEqual(["2026-09-03"]);
    expect(norms("Meet Mar 14", "date")).toEqual(["2026-03-14"]);
    expect(norms("Trip planned 2024-12-01; flight on Dec 5", "date")).toEqual(["2024-12-01", "2024-12-05"]);
    expect(extractEntities("Party on Sept 3rd", { now: new Date(2030, 0, 1) }).find((e) => e.type === "date")?.normalized).toBe(
      "2030-09-03",
    );
  });

  test("numeric dates: a part above 12 decides the order, and the document's convention is reused", () => {
    expect(norms("On 25/12/2026", "date")).toEqual(["2026-12-25"]);
    expect(norms("On 12/25/2026", "date")).toEqual(["2026-12-25"]);
    expect(norms("On 04/05/2026", "date")).toEqual(["2026-04-05"]);
    expect(norms("On 04.05.2026", "date")).toEqual(["2026-05-04"]);
    expect(norms("Booked 25/12/2026, paid 04/05/2026", "date")).toEqual(["2026-12-25", "2026-05-04"]);
  });

  test("invalid dates, versions and verbs are not dates", () => {
    expect(norms("On 31/02/2026 and 2026-13-01 and 45/45/2026", "date")).toEqual([]);
    expect(norms("Upgrade to 1.2.30 then v2.10.12", "date")).toEqual([]);
    expect(norms("You may 2x the dose. Then march 3 miles.", "date")).toEqual([]);
  });

  test("a statement's month-name dates and currency decide ambiguous numeric dates", () => {
    const statement = "Period: 01-Oct-2026 to 31-Oct-2026\n02/10/26 UPI 450.00\n05/10/26 SALARY ₹1,25,000.00";
    expect(norms(statement, "date")).toEqual(["2026-10-01", "2026-10-31", "2026-10-02", "2026-10-05"]);
    expect(norms("Receipt 11/02/2026 TOTAL $13.98", "date")).toEqual(["2026-11-02"]);
    expect(norms("Booked on October 1, 2026; paid 02/10/2026", "date")).toEqual(["2026-10-01", "2026-02-10"]);
  });

  test("dates are never also phone numbers", () => {
    const all = ents("Call by 2026-03-14 or 14/03/2026");
    expect(all.filter((e) => e.type === "phone")).toEqual([]);
    expect(all.filter((e) => e.type === "date")).toHaveLength(1);
  });
});

// ───────────────────────────── entities: names ─────────────────────────────

test.describe("extractEntities — names", () => {
  test("multi-word proper nouns, connectors and company suffixes", () => {
    const text =
      "Lunch with Sarah Chen and Ludwig van Beethoven at the Bank of America office. " +
      "Contracts with Acme Inc. and Globex GmbH and Initech Pvt. Ltd were signed, plus Procter & Gamble.";
    expect(values(text, "name")).toEqual(
      expect.arrayContaining([
        "Sarah Chen",
        "Ludwig van Beethoven",
        "Bank of America",
        "Acme Inc",
        "Globex GmbH",
        "Initech Pvt. Ltd",
        "Procter & Gamble",
      ]),
    );
  });

  test("honorifics are dropped and possessives stripped", () => {
    const names = ents("We met Dr. Sarah Chen yesterday. Mr. Patel called about Sarah Chen's report.", "name");
    expect(names.map((n) => n.value)).toEqual(["Sarah Chen", "Patel"]);
    expect(names[0].count).toBe(2);
    expect(names[0].normalized).toBe("sarah chen");
  });

  test("single capitalised words need two mentions", () => {
    expect(values("I talked to Priya about it.", "name")).toEqual([]);
    expect(values("I talked to Priya about it. Later Priya sent the deck.", "name")).toEqual(["Priya"]);
  });

  test("sentence starters, months, weekdays, greetings and common words are skipped", () => {
    const text =
      "Meeting Notes\nThe plan is ready. Finally we shipped. Finally done. Thanks, team. " +
      "On Monday in March we review. Hi there. Please check. Call tomorrow.";
    expect(values(text, "name")).toEqual([]);
  });

  test("sentence-initial verbs are not part of names", () => {
    expect(values("Visited Paris Hilton yesterday. Ask Priya Raman about it.", "name")).toEqual([
      "Paris Hilton",
      "Priya Raman",
    ]);
  });

  test("ALL-CAPS OCR noise is ignored, real acronyms that repeat are kept", () => {
    const receipt = "TOTAL AMOUNT DUE\nTAX INVOICE\nQTY ITEM PRICE\nTHANK YOU FOR SHOPPING\nCASH CHANGE";
    expect(values(receipt, "name")).toEqual([]);
    expect(values("We partnered with NASA in May. Later NASA confirmed the launch with the PDF attached.", "name")).toEqual([
      "NASA",
    ]);
  });

  test("job titles in signatures are not names", () => {
    const sig = "Best regards,\nPriya Raman\nHead of Partnerships, Initech Pvt. Ltd.\nSenior Product Manager";
    expect(values(sig, "name")).toEqual(["Priya Raman", "Initech Pvt. Ltd"]);
  });

  test("long Title Case heading lines are not names", () => {
    expect(values("Quarterly Business Review Planning Notes\nwe discussed things.", "name")).toEqual([]);
  });

  test("names are ranked by mentions and capped by maxNames", () => {
    const text =
      "Alice Wong met Bob Stone. Alice Wong called Carol King. Alice Wong emailed Bob Stone. Then Dan Brown left.";
    const names = ents(text, "name");
    expect(names.map((n) => n.value).slice(0, 2)).toEqual(["Alice Wong", "Bob Stone"]);
    expect(names[0].count).toBe(3);
    expect(ents(text, "name", { maxNames: 2 })).toHaveLength(2);
    expect(ents(text, "name").length).toBeLessThanOrEqual(15);
  });

  test("names inside emails and links are not extracted", () => {
    expect(values("Mail Sarah.Chen@Acme.com or visit Acme.com/Team", "name")).toEqual([]);
  });
});

// ───────────────────────────── entities: tags & topics ─────────────────────────────

test.describe("extractEntities — tags and topics", () => {
  test("hashtags", () => {
    const tags = ents("Shipping #Launch and #q3-plan today. #launch again!", "tag");
    expect(tags.map((t) => [t.value, t.normalized, t.count])).toEqual([
      ["#Launch", "launch", 2],
      ["#q3-plan", "q3-plan", 1],
    ]);
  });

  test("issue numbers, colours, anchors and C# are not tags", () => {
    expect(norms("Fixed #123, colour #a1b2c3 and #fff0, see https://acme.com/#pricing, written in C#", "tag")).toEqual([]);
  });

  test("topics favour frequent, longer content words and skip stopwords and numbers", () => {
    const text =
      "The onboarding flow needs work. Onboarding emails go out daily and onboarding metrics improved. " +
      "Retention is up while retention cohorts look healthy. The the the and and 2026 2026 2026.";
    const topics = ents(text, "topic");
    expect(topics.length).toBeLessThanOrEqual(5);
    expect(topics[0].normalized).toBe("onboarding");
    expect(topics[0].count).toBe(3);
    expect(topics[1].normalized).toBe("retention");
    for (const t of topics) {
      expect(t.normalized.length).toBeGreaterThanOrEqual(4);
      expect(t.normalized).not.toMatch(/^\d+$/);
      expect(["the", "and", "with", "that"]).not.toContain(t.normalized);
    }
  });

  test("plural and singular forms merge; maxTopics is honoured", () => {
    const topics = ents("Invoice sent. Two invoices pending. Another invoice due. Budget approved.", "topic");
    expect(topics[0].normalized).toBe("invoice");
    expect(topics[0].count).toBe(3);
    expect(ents("alpha bravo charlie delta echoes foxtrot golfing hotels", "topic", { maxTopics: 3 })).toHaveLength(3);
    expect(ents("alpha bravo charlie delta", "topic", { maxTopics: 0 })).toHaveLength(0);
  });
});

// ───────────────────────────── entities: general ─────────────────────────────

test.describe("extractEntities — general", () => {
  test("empty or blank text yields nothing", () => {
    expect(extractEntities("")).toEqual([]);
    expect(extractEntities("   \n\t ")).toEqual([]);
  });

  test("a realistic note yields one entity per thing, with offsets pointing at the first mention", () => {
    const text =
      "Meeting with Sarah Chen (sarah.chen@acme.com, +1 (415) 555-0134) on March 14, 2026 about the Phoenix launch.\n" +
      "Budget approved: $12,400. Plan: https://acme.com/phoenix #launch";
    const all = ents(text);
    for (const e of all) {
      if (e.type === "topic") continue;
      expect(text.slice(e.index, e.index + e.value.length), `${e.type} ${e.value}`).toBe(e.value);
    }
    const byType = (t: EntityType) => all.filter((e) => e.type === t).map((e) => e.normalized);
    expect(byType("phone")).toEqual(["+14155550134"]);
    expect(byType("email")).toEqual(["sarah.chen@acme.com"]);
    expect(byType("url")).toEqual(["acme.com/phoenix"]);
    expect(byType("money")).toEqual(["USD 12400"]);
    expect(byType("date")).toEqual(["2026-03-14"]);
    expect(byType("name")).toEqual(["sarah chen"]);
    expect(byType("tag")).toEqual(["launch"]);
    const keys = all.map((e) => `${e.type}:${e.normalized}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("200k characters are processed in under 150 ms", () => {
    const base =
      "Meeting with Sarah Chen (sarah.chen@acme.com, +1 (415) 555-0134) on March 14, 2026 about Phoenix.\n" +
      "Budget approved: $12,400 for Q2. See https://acme.com/phoenix/plan. Paid ₹1,200 via UPI ref 4058123456.\n" +
      "Invoice INV-2024-00123 dated 14/03/2026 from Globex GmbH, total EUR 1.234,56. #launch #phoenix\n" +
      "Then Priya Raman from Initech Pvt. Ltd. called on 98765-43210 about onboarding and retention.\n\n";
    const text = base.repeat(Math.ceil(200_000 / base.length)).slice(0, 200_000);
    extractEntities(text.slice(0, 20_000)); // warm up the regex engine
    const t0 = performance.now();
    const out = extractEntities(text);
    const ms = performance.now() - t0;
    expect(out.length).toBeGreaterThan(5);
    expect(ms).toBeLessThan(150);
  });

  test("pathological input stays fast", () => {
    const inputs = ["a".repeat(100_000), "1".repeat(100_000), "a.".repeat(50_000), "x@".repeat(50_000), "1 2 3 ".repeat(30_000)];
    for (const input of inputs) {
      const t0 = performance.now();
      extractEntities(input);
      expect(performance.now() - t0).toBeLessThan(150);
    }
  });
});

test.describe("normalizeEntity", () => {
  test("normalises every entity type", () => {
    expect(normalizeEntity("phone", "+1 (415) 555-0134")).toBe("+14155550134");
    expect(normalizeEntity("phone", "0044 20 7946 0958")).toBe("+442079460958");
    expect(normalizeEntity("phone", "415.555.0134")).toBe("4155550134");
    expect(normalizeEntity("email", " Sarah@Acme.COM ")).toBe("sarah@acme.com");
    expect(normalizeEntity("url", "HTTPS://WWW.Acme.com/Docs/")).toBe("acme.com/Docs");
    expect(normalizeEntity("money", "$1,234.56")).toBe("USD 1234.56");
    expect(normalizeEntity("money", "Rs. 500")).toBe("INR 500");
    expect(normalizeEntity("money", "3.5k")).toBe("3500");
    expect(normalizeEntity("date", "March 14, 2026")).toBe("2026-03-14");
    expect(normalizeEntity("date", "March 2026")).toBe("2026-03");
    expect(normalizeEntity("name", "Dr. Sarah  Chen")).toBe("sarah chen");
    expect(normalizeEntity("tag", "#Launch")).toBe("launch");
    expect(normalizeEntity("topic", "Onboarding")).toBe("onboarding");
  });

  test("agrees with the extractor's normalized values", () => {
    const text = "Call +44 20 7946 0958, mail Sarah@Acme.com, see www.Acme.com/Docs/, pay ₹1,200 by 14 Mar 2026. #Ship";
    for (const e of ents(text)) {
      if (e.type === "topic" || e.type === "name") continue;
      expect(normalizeEntity(e.type, e.value), `${e.type} ${e.value}`).toBe(e.normalized);
    }
  });
});

// ───────────────────────────── chunking ─────────────────────────────

function sentences(n: number, prefix = "Sentence"): string {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1} covers the quarterly plan and budget details.`).join(" ");
}

function expectValidChunks(full: string, chunks: ReturnType<typeof chunkText>) {
  chunks.forEach((c, i) => {
    expect(c.index).toBe(i);
    expect(c.text.length).toBeGreaterThan(0);
    expect(c.text).toBe(full.slice(c.start, c.end));
    expect(c.text).toBe(c.text.trim());
    expect(c.text.length).toBeLessThanOrEqual(LIMITS.chunkTargetChars);
  });
  // Every non-space character is covered by some chunk.
  const covered = new Uint8Array(full.length);
  for (const c of chunks) covered.fill(1, c.start, c.end);
  const uncovered: number[] = [];
  for (let i = 0; i < full.length; i++) if (!covered[i] && /\S/.test(full[i])) uncovered.push(i);
  expect(uncovered).toEqual([]);
}

test.describe("chunkText", () => {
  test("empty and blank text give no chunks", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("  \n\n \t")).toEqual([]);
    expect(chunkText("", [])).toEqual([]);
  });

  test("short text is one trimmed chunk with exact offsets", () => {
    expect(chunkText("  hello world \n")).toEqual([{ index: 0, text: "hello world", start: 2, end: 13 }]);
  });

  test("long text splits on paragraph and sentence boundaries with overlap", () => {
    const full = [sentences(8, "Alpha"), sentences(12, "Beta"), "Short closing paragraph."].join("\n\n");
    const chunks = chunkText(full);
    expect(chunks.length).toBeGreaterThan(1);
    expectValidChunks(full, chunks);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start).toBeGreaterThan(chunks[i - 1].start);
      expect(chunks[i].start).toBeLessThan(chunks[i - 1].end); // overlap
      expect(chunks[i - 1].end - chunks[i].start).toBeLessThanOrEqual(LIMITS.chunkOverlapChars);
    }
    for (const c of chunks.slice(0, -1)) expect(c.text).toMatch(/[.!?]$/); // ends at a sentence boundary
    for (const c of chunks.slice(1)) expect(c.text).toMatch(/^[A-Z]/); // overlap starts at a sentence
  });

  test("text without whitespace is hard-cut without splitting emoji", () => {
    const full = "😀".repeat(900);
    const chunks = chunkText(full);
    expect(chunks.length).toBeGreaterThan(2);
    expectValidChunks(full, chunks);
    for (const c of chunks) expect(c.text.length % 2).toBe(0);
  });

  test("pages: chunks carry page numbers, never span pages and use full-text offsets", () => {
    const pages = [sentences(30, "One"), "", "   ", "Page four is short."];
    const full = pages.join(PAGE_SEPARATOR);
    const chunks = chunkText(full, pages);
    expectValidChunks(full, chunks);
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 4]));
    let offset = 0;
    const bounds = pages.map((p) => {
      const b = [offset, offset + p.length];
      offset += p.length + PAGE_SEPARATOR.length;
      return b;
    });
    for (const c of chunks) {
      const [a, b] = bounds[(c.page ?? 0) - 1];
      expect(c.start).toBeGreaterThanOrEqual(a);
      expect(c.end).toBeLessThanOrEqual(b);
    }
    expect(chunks[chunks.length - 1]).toMatchObject({ page: 4, text: "Page four is short." });
  });

  test("text without pages has no page field", () => {
    for (const c of chunkText(sentences(40))) expect(c.page).toBeUndefined();
  });

  test("200k characters chunk quickly", () => {
    const full = sentences(4000);
    const t0 = performance.now();
    const chunks = chunkText(full);
    expect(performance.now() - t0).toBeLessThan(150);
    expectValidChunks(full, chunks);
  });
});

test.describe("deriveTitle / deriveSummary", () => {
  test("titles come from the first meaningful line, without markdown", () => {
    expect(deriveTitle("# Quarterly *plan* for **2026**\nbody text", "x")).toBe("Quarterly plan for 2026");
    expect(deriveTitle("\n\n- [ ] Buy milk\n- eggs", "x")).toBe("Buy milk");
    expect(deriveTitle("1. First step: install\n2. Second", "x")).toBe("First step: install");
    expect(deriveTitle("> Quote of the [day](https://x.com).", "x")).toBe("Quote of the day");
    expect(deriveTitle("---\n```\n|a|\n~~~\n### Real heading", "x")).toBe("Real heading");
    expect(deriveTitle("Subject: Re: Lunch with Priya on Friday", "x")).toBe("Lunch with Priya on Friday");
    expect(deriveTitle("<p>Hello <b>world</b></p>", "x")).toBe("Hello world");
  });

  test("OCR debris is skipped and long lines are clipped at a word", () => {
    expect(deriveTitle("|| ~ ;; 1 2\nInvoice from Acme", "x")).toBe("Invoice from Acme");
    const long = deriveTitle(`${"word ".repeat(40)}end`, "x");
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/wor…$/);
    expect(deriveTitle("This is the first sentence of a long paragraph. It goes on and on and on for quite a while longer than eighty characters.", "x")).toBe(
      "This is the first sentence of a long paragraph",
    );
  });

  test("pasted emails use their subject; summaries skip the header block", () => {
    const email =
      "From: Priya Raman <priya@initech.com>\nSent: Tuesday, November 3, 2026 9:14 AM\nTo: Sarah Chen\n" +
      "Subject: RE: Fwd: Phoenix contract renewal\n\nHi Sarah,\nThanks for the call yesterday.";
    expect(deriveTitle(email, "x")).toBe("Phoenix contract renewal");
    expect(deriveSummary(email)).toBe("Hi Sarah, Thanks for the call yesterday.");
    expect(deriveTitle("From: a@b.com\nTo: c@d.com\n\nLunch plans for Friday", "x")).toBe("Lunch plans for Friday");
  });

  test("falls back when nothing is usable", () => {
    expect(deriveTitle("", "Pasted text")).toBe("Pasted text");
    expect(deriveTitle("  \n ~~~ \n 12 34", "Screenshot 2026-03-14")).toBe("Screenshot 2026-03-14");
    expect(deriveTitle("https://example.com/some/article", "x")).toBe("example.com/some/article");
  });

  test("summaries are clean, single-line and ≤ 280 chars", () => {
    expect(deriveSummary("# Groceries\n- milk\n- eggs\n- [Bread](http://x.com)\n\nRemember to pay <b>rent</b>.")).toBe(
      "milk · eggs · Bread · Remember to pay rent.",
    );
    expect(deriveSummary("Line one\nwraps here.\n\nNext   para")).toBe("Line one wraps here. Next para");
    const long = deriveSummary("lorem ipsum ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(280);
    expect(long.endsWith("…")).toBe(true);
    expect(deriveSummary("")).toBe("");
    expect(deriveSummary("   ")).toBe("");
  });
});

// ───────────────────────────── query parsing ─────────────────────────────

function range(q: string, now = NOW) {
  const r = parseQuery(q, now).dateRange;
  return r && { from: r.from, to: r.to, label: r.label };
}

test.describe("parseQuery — required examples", () => {
  test("Where did I see that product?", () => {
    const p = parseQuery("Where did I see that product?", NOW);
    expect(p.keywords).toBe("product");
    expect(p.intents).toEqual([]);
    expect(p.kindHints).toEqual([]);
    expect(p.dateRange).toBeUndefined();
    expect(p.raw).toBe("Where did I see that product?");
    expect(p.semantic).toBe("Where did I see that product?");
  });

  test("What was that person's phone number in the screenshot?", () => {
    const p = parseQuery("What was that person's phone number in the screenshot?", NOW);
    expect(p.intents).toEqual(["phone"]);
    expect(p.kindHints).toEqual(["image"]);
    expect(p.keywords).toBe("person");
    expect(p.dateRange).toBeUndefined();
  });

  test("Which document mentioned this amount?", () => {
    const p = parseQuery("Which document mentioned this amount?", NOW);
    expect(p.intents).toEqual(["money"]);
    expect(p.kindHints).toEqual(["pdf"]);
    expect(p.keywords).toBe("");
  });

  test("What did I decide about that project last month?", () => {
    const p = parseQuery("What did I decide about that project last month?", NOW);
    expect(p.dateRange).toEqual({ from: at(2026, 10, 1), to: at(2026, 11, 1), label: "last month" });
    expect(p.kindHints).toEqual(["note"]);
    expect(p.keywords.split(" ")).toContain("project");
    expect(p.keywords).toMatch(/^(?:decide |decided )?project$/);
    expect(p.semantic).toBe("What did I decide about that project?");
  });
});

test.describe("parseQuery — time phrases", () => {
  test("days", () => {
    expect(range("notes today")).toEqual({ from: at(2026, 11, 11), to: at(2026, 11, 12), label: "today" });
    expect(range("yesterday's call recording")).toEqual({ from: at(2026, 11, 10), to: at(2026, 11, 11), label: "yesterday" });
    expect(range("photos from the day before yesterday")?.from).toBe(at(2026, 11, 9));
    expect(range("this morning")?.label).toBe("today");
  });

  test("weeks start on Monday", () => {
    expect(range("this week")).toEqual({ from: at(2026, 11, 9), to: at(2026, 11, 16), label: "this week" });
    expect(range("last week")).toEqual({ from: at(2026, 11, 2), to: at(2026, 11, 9), label: "last week" });
    const sunday = new Date(2026, 10, 15, 20);
    expect(range("this week", sunday)?.from).toBe(at(2026, 11, 9));
    expect(range("last week", sunday)?.from).toBe(at(2026, 11, 2));
    const monday = new Date(2026, 10, 9, 8);
    expect(range("this week", monday)?.from).toBe(at(2026, 11, 9));
    expect(range("last week", monday)).toMatchObject({ from: at(2026, 11, 2), to: at(2026, 11, 9) });
  });

  test("months and years are calendar-correct", () => {
    expect(range("this month")).toEqual({ from: at(2026, 11, 1), to: at(2026, 12, 1), label: "this month" });
    expect(range("last month")).toEqual({ from: at(2026, 10, 1), to: at(2026, 11, 1), label: "last month" });
    expect(range("last month", new Date(2026, 0, 15))).toMatchObject({ from: at(2025, 12, 1), to: at(2026, 1, 1) });
    expect(range("this year")).toEqual({ from: at(2026, 1, 1), to: at(2027, 1, 1), label: "this year" });
    expect(range("last year")).toEqual({ from: at(2025, 1, 1), to: at(2026, 1, 1), label: "last year" });
  });

  test("rolling windows: past/last N days, weeks, months", () => {
    expect(range("past 7 days")).toEqual({ from: at(2026, 11, 4), to: at(2026, 11, 12), label: "past 7 days" });
    expect(range("in the last 3 weeks")).toEqual({ from: at(2026, 10, 21), to: at(2026, 11, 12), label: "past 3 weeks" });
    expect(range("last 2 months")).toEqual({ from: at(2026, 9, 11), to: at(2026, 11, 12), label: "past 2 months" });
    expect(range("past few days")?.from).toBe(at(2026, 11, 8));
    expect(range("over the past week")).toMatchObject({ from: at(2026, 11, 4), to: at(2026, 11, 12) });
    expect(range("last 30 days", new Date(2026, 2, 31))?.from).toBe(at(2026, 3, 1));
  });

  test("N units ago gives a window around that time", () => {
    const r = range("3 days ago");
    expect(r?.label).toBe("3 days ago");
    expect(r!.from).toBeLessThanOrEqual(at(2026, 11, 8));
    expect(r!.to).toBeGreaterThan(at(2026, 11, 8));
    expect(r!.to).toBeLessThanOrEqual(at(2026, 11, 11));
    const w = range("two weeks ago");
    expect(w!.from).toBeLessThanOrEqual(at(2026, 10, 28));
    expect(w!.to).toBeGreaterThan(at(2026, 10, 28));
    expect(range("a week ago")?.label).toBe("a week ago");
    const m = range("2 months ago");
    expect(m!.from).toBeLessThanOrEqual(at(2026, 9, 11));
    expect(m!.to).toBeGreaterThan(at(2026, 9, 11));
    expect(range("1 day ago")).toMatchObject({ from: at(2026, 11, 10), to: at(2026, 11, 11) });
  });

  test("named months", () => {
    expect(range("in March")).toEqual({ from: at(2026, 3, 1), to: at(2026, 4, 1), label: "March 2026" });
    expect(range("in December")).toEqual({ from: at(2025, 12, 1), to: at(2026, 1, 1), label: "December 2025" });
    expect(range("in November")?.from).toBe(at(2026, 11, 1));
    expect(range("March 2025")).toEqual({ from: at(2025, 3, 1), to: at(2025, 4, 1), label: "March 2025" });
    expect(range("receipts from sept 2024")?.from).toBe(at(2024, 9, 1));
    expect(range("last March")?.from).toBe(at(2026, 3, 1));
    expect(range("last March", new Date(2026, 2, 20))?.from).toBe(at(2025, 3, 1));
    expect(range("last November")?.from).toBe(at(2025, 11, 1));
    expect(range("since March")).toEqual({ from: at(2026, 3, 1), to: at(2026, 11, 12), label: "since March 2026" });
    expect(range("since May 2025")?.from).toBe(at(2025, 5, 1));
    expect(range("before March")).toMatchObject({ from: 0, to: at(2026, 3, 1) });
    expect(range("in 2025")).toEqual({ from: at(2025, 1, 1), to: at(2026, 1, 1), label: "2025" });
  });

  test("specific days", () => {
    expect(range("receipt from March 14")).toEqual({ from: at(2026, 3, 14), to: at(2026, 3, 15), label: "Mar 14, 2026" });
    expect(range("14th of December")?.from).toBe(at(2025, 12, 14));
    expect(range("dec 14 2026")?.from).toBe(at(2026, 12, 14));
    expect(range("on 2026-03-14")?.from).toBe(at(2026, 3, 14));
    expect(range("on 25/12/2025")?.from).toBe(at(2025, 12, 25));
  });

  test("weekdays mean the most recent past day", () => {
    expect(range("on Monday")).toEqual({ from: at(2026, 11, 9), to: at(2026, 11, 10), label: "Monday, Nov 9" });
    expect(range("last friday")?.from).toBe(at(2026, 11, 6));
    expect(range("wednesday")?.from).toBe(at(2026, 11, 4));
    expect(range("on Monday", new Date(2026, 10, 9, 12))?.from).toBe(at(2026, 11, 2));
    expect(range("this monday")?.from).toBe(at(2026, 11, 9));
    expect(range("sunday night")?.from).toBe(at(2026, 11, 8));
  });

  test("recently, weekends and since-phrases", () => {
    expect(range("recently saved links")).toEqual({ from: at(2026, 10, 12), to: at(2026, 11, 12), label: "last 30 days" });
    expect(range("recent invoices")?.label).toBe("last 30 days");
    expect(range("last weekend")).toMatchObject({ from: at(2026, 11, 7), to: at(2026, 11, 9) });
    expect(range("since last week")).toMatchObject({ from: at(2026, 11, 2), to: at(2026, 11, 12) });
  });

  test("no time phrase → no dateRange; time words in content stay", () => {
    for (const q of ["product roadmap", "what may I have missed", "marketing plan", "monthly budget", "may"]) {
      expect(parseQuery(q, NOW).dateRange, q).toBeUndefined();
    }
  });

  test("time phrases leave keywords and semantic", () => {
    const p = parseQuery("invoices from Acme in March 2025", NOW);
    expect(p.semantic).toBe("invoices from Acme");
    expect(p.keywords).toBe("invoices acme");
    const q = parseQuery("notes from last week", NOW);
    expect(q.semantic).toBe("notes");
    expect(q.keywords).toBe("");
    expect(parseQuery("last week", NOW).semantic).toBe("");
  });
});

test.describe("parseQuery — intents and kind hints", () => {
  const intents = (q: string) => parseQuery(q, NOW).intents;
  const kinds = (q: string) => parseQuery(q, NOW).kindHints;

  test("phone intent", () => {
    for (const q of ["sarah's phone", "contact number for the plumber", "who should I call", "mobile of the driver", "cell", "whatsapp of Raj", "tel of the clinic", "the number of the dentist"]) {
      expect(intents(q), q).toContain("phone");
    }
    for (const q of ["invoice number", "order number 4058", "the number of people"]) expect(intents(q), q).not.toContain("phone");
  });

  test("email intent", () => {
    for (const q of ["email of the recruiter", "her e-mail", "mail id of HR", "is sarah@acme.com in there"]) {
      expect(intents(q), q).toContain("email");
    }
  });

  test("url intent", () => {
    for (const q of ["link to the article", "url for the docs", "that website", "the site about hiking", "webpage I read"]) {
      expect(intents(q), q).toContain("url");
    }
  });

  test("money intent", () => {
    for (const q of ["amount on the bill", "price of the lamp", "what did it cost", "how much did I pay", "total spent on flights", "invoice amount", "the $ figure", "₹ paid to the cab", "€ for rent", "£ fee"]) {
      expect(intents(q), q).toContain("money");
    }
  });

  test("date and name intents", () => {
    for (const q of ["date of the party", "when is the exam", "deadline for taxes", "when is rent due"]) expect(intents(q), q).toContain("date");
    for (const q of ["who sent the contract", "person's name from the conference", "which company quoted us"]) expect(intents(q), q).toContain("name");
  });

  test("kind hints", () => {
    const cases: [string, string][] = [
      ["that screenshot", "image"],
      ["the screen shot of the error", "image"],
      ["photo of the whiteboard", "image"],
      ["picture of the receipt", "image"],
      ["pic from the trip", "image"],
      ["scan of my passport", "image"],
      ["the pdf about leases", "pdf"],
      ["bank statement", "pdf"],
      ["quarterly report", "pdf"],
      ["that file", "pdf"],
      ["voice memo about groceries", "voice"],
      ["audio from the lecture", "voice"],
      ["meeting recording", "voice"],
      ["call recording with the bank", "voice"],
      ["podcast about sleep", "voice"],
      ["notes on the design", "note"],
      ["what we decided on pricing", "note"],
      ["my idea for the app", "note"],
      ["todo for the weekend", "note"],
      ["copied text about react", "text"],
      ["clipboard snippet", "text"],
      ["pasted address", "text"],
    ];
    for (const [q, kind] of cases) expect(kinds(q), q).toContain(kind);
    expect(intents("call recording with the bank")).not.toContain("phone");
    expect(kinds("voice note about lunch")).toEqual(["voice"]);
  });

  test("video kind hints", () => {
    const cases = [
      "that video about sourdough",
      "videos from the trip",
      "the clip of the keynote",
      "video clip with the demo",
      "screen recording of the checkout bug",
      "the screenrecording from standup",
      "screencast about the deploy",
      "screen cast of the dashboard",
      "reel about knots",
      "the movie trailer",
      "youtube talk on rust",
      "YouTube tutorial",
      "you tube recipe",
    ];
    for (const q of cases) expect(kinds(q), q).toContain("video");
  });

  test("recording stays voice unless it's a screen recording", () => {
    expect(kinds("screen recording of the bug")).toEqual(["video"]);
    expect(kinds("screen recorded walkthrough")).toEqual(["video"]);
    expect(kinds("meeting recording")).toEqual(["voice"]);
    expect(kinds("recorded lecture on tax")).toEqual(["voice"]);
    expect(kinds("call recording with the bank")).toEqual(["voice"]);
    expect(kinds("voice memo")).toEqual(["voice"]);
    expect(kinds("clipboard snippet")).toEqual(["text"]);
    expect(kinds("screenshot of the video")).toEqual(["image", "video"]);
  });

  test("video words leave keywords clean, content-like ones stay", () => {
    expect(parseQuery("screen recording of the checkout bug", NOW).keywords).toBe("checkout bug");
    expect(parseQuery("the video about sourdough starters", NOW).keywords).toBe("sourdough starters");
    expect(parseQuery("youtube lecture on rust", NOW).keywords).toBe("youtube lecture rust");
    expect(parseQuery("that movie Sam recommended", NOW).keywords).toBe("movie sam recommended");
    const p = parseQuery("the clip from last week with the pricing slide", NOW);
    expect(p.kindHints).toEqual(["video"]);
    expect(p.intents).toEqual(["money"]);
    expect(p.dateRange?.label).toBe("last week");
  });

  test("intents and kinds are deduped and ordered by appearance", () => {
    const p = parseQuery("price and amount in the pdf document and the screenshot", NOW);
    expect(p.intents).toEqual(["money"]);
    expect(p.kindHints).toEqual(["pdf", "image"]);
  });

  test("keywords drop filler, intent and container words but keep content", () => {
    expect(parseQuery("show me the screenshot with the wifi password", NOW).keywords).toBe("wifi password");
    expect(parseQuery("what was the phone number of the plumber in the pdf?", NOW).keywords).toBe("plumber");
    expect(parseQuery("Do you remember the link Sarah mentioned about Rust?", NOW).keywords).toBe("sarah rust");
    expect(parseQuery("bank statement balance", NOW).keywords).toBe("bank statement balance");
    expect(parseQuery("meeting recording about hiring", NOW).keywords).toBe("meeting hiring");
    const pricing = parseQuery("what did sarah say about pricing in the call yesterday", NOW);
    expect(pricing.keywords).toBe("sarah pricing call");
    expect(pricing.intents).toEqual(["money", "phone"]);
    expect(pricing.dateRange?.label).toBe("yesterday");
    expect(parseQuery("the the the", NOW).keywords).toBe("");
  });

  test("empty input is safe", () => {
    expect(parseQuery("", NOW)).toEqual({ raw: "", keywords: "", semantic: "", intents: [], kindHints: [] });
    expect(parseQuery("   ", NOW).keywords).toBe("");
  });

  test("defaults now to the current time", () => {
    const r = parseQuery("today").dateRange!;
    expect(r.from).toBeLessThanOrEqual(Date.now());
    expect(r.to).toBeGreaterThan(Date.now());
  });
});

test.describe("tokenize", () => {
  test("lower-cases, strips possessives and contractions, drops stopwords and 1-char tokens", () => {
    expect(tokenize("Sarah's phone number, don't forget the e-mail! Q3 report 2026 — café a b")).toEqual([
      "sarah",
      "phone",
      "number",
      "forget",
      "mail",
      "q3",
      "report",
      "2026",
      "café",
    ]);
    expect(tokenize("")).toEqual([]);
    expect(tokenize("the and of to")).toEqual([]);
  });
});
