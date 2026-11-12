/**
 * Content for "Try sample memories": ten realistic, varied memories that make search, smart
 * answers and the knowledge graph light up on a first visit — without any network or files.
 *
 * Pure: everything is computed from `now`, so dates read naturally whenever the samples are
 * loaded (the decision note always falls in the previous calendar month, so "last month" works;
 * the flight is always a few weeks ahead, and so on). People, companies and links are fictional
 * (phone numbers use the reserved 555-01xx range, links use example.com).
 */
import type { MemoryKind } from "../types";
import { DAY_MS } from "./helpers";

export interface SampleMemory {
  /** Stable id so loading twice never duplicates. */
  id: string;
  kind: MemoryKind;
  title: string;
  text: string;
  /** Lowercase, no '#'. */
  tags: string[];
  createdAt: number;
  sourceDate?: number;
  sourceName?: string;
  mimeType?: string;
  pageCount?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  ocrConfidence?: number;
}

/** A question that shows off smart answers on the sample data. */
export const SAMPLE_QUESTION = "What's Priya's phone number?";

const fmtDate = (ms: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(ms));
const fmtDay = (ms: number) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(ms));
const fmtMonthDay = (ms: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(ms));

/** `days` before `now` at a given local time of day. */
function daysAgo(now: Date, days: number, hours: number, minutes: number): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hours, minutes, 0, 0);
  return Math.min(d.getTime(), now.getTime() - 60_000);
}

/** A date about five weeks back that always lands inside the previous calendar month. */
function inPreviousMonth(now: Date): number {
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 2, 16, 40);
  const last = new Date(now.getFullYear(), now.getMonth(), 0, 16, 40); // last day of previous month
  last.setDate(last.getDate() - 1);
  const target = daysAgo(now, 37, 16, 40);
  return Math.min(Math.max(target, first.getTime()), last.getTime());
}

export function buildSampleMemories(now: Date = new Date()): SampleMemory[] {
  const apartmentAt = daysAgo(now, 68, 20, 14);
  const bookAt = daysAgo(now, 58, 21, 40);
  const wifiAt = daysAgo(now, 47, 18, 5);
  const decisionAt = inPreviousMonth(now);
  const recipeAt = daysAgo(now, 33, 19, 22);
  const chairAt = daysAgo(now, 23, 13, 47);
  const invoiceAt = daysAgo(now, 20, 9, 12);
  const meetingAt = daysAgo(now, 12, 10, 31);
  const contactAt = daysAgo(now, 9, 16, 3);
  const flightAt = daysAgo(now, 2, 22, 48);

  const availableOn = apartmentAt + 24 * DAY_MS;
  const invoiceIssued = invoiceAt - 7 * DAY_MS;
  const invoiceDue = invoiceIssued + 15 * DAY_MS;
  const outbound = flightAt + 36 * DAY_MS;
  const inbound = outbound + 4 * DAY_MS;
  const launchReview = decisionAt + 64 * DAY_MS;

  return [
    {
      id: "sample_apartment",
      kind: "text",
      title: "Sunny 2BR in the Inner Sunset — $3,450/month",
      createdAt: apartmentAt,
      mimeType: "text/plain",
      tags: ["apartment-hunt"],
      text: [
        "Sunny 2BR / 1BA in the Inner Sunset — $3,450/month",
        "",
        "1427 Irving St, Apt 3, San Francisco, CA 94122",
        `Available ${fmtDate(availableOn)} · 12-month lease · Deposit $3,450`,
        "",
        "• 850 sq ft, top floor, lots of morning light",
        "• Hardwood floors, renovated kitchen with dishwasher",
        "• In-unit washer/dryer, bike storage in the garage",
        "• Cats OK, small dogs considered",
        "• Two blocks to the N Judah and Golden Gate Park",
        "",
        "Open house: Saturday 11 am – 1 pm",
        "Contact Lena Ortiz (leasing agent): lena@sunsetflats.co · (415) 555-0187",
        "Listing: https://rentals.example.com/listing/1427-irving-apt-3",
      ].join("\n"),
    },
    {
      id: "sample_book",
      kind: "text",
      title: "Book tip from Sam: Four Thousand Weeks",
      createdAt: bookAt,
      mimeType: "text/plain",
      tags: ["reading", "books"],
      text: [
        "From Sam:",
        "“You have to read Four Thousand Weeks by Oliver Burkeman. It completely changed how I think about to-do lists — you'll never get everything done, so choose what really matters. Also The Design of Everyday Things by Don Norman if you haven't read it yet.”",
        "",
        "Next up on my reading list. The library has it, or the paperback is about $18.",
        "",
        "#reading #books",
      ].join("\n"),
    },
    {
      id: "sample_wifi",
      kind: "note",
      title: "Home Wi-Fi & router details",
      createdAt: wifiAt,
      tags: ["home"],
      text: [
        "Home Wi-Fi & router",
        "",
        "Network (5 GHz): Morgan-Home-5G",
        "Password: lemon-otter-42",
        "Guest network: Morgan-Guest · password: welcome-guest-7",
        "",
        "Router admin page: http://192.168.1.1 (user: admin — the password is on the sticker under the router)",
        "Internet provider: BayFiber, account BF3041877 · support +1 (888) 555-0170",
        "",
        "If the internet drops: unplug the router for 30 seconds, plug it back in, and wait about 2 minutes until the light turns solid white.",
        "",
        "#home",
      ].join("\n"),
    },
    {
      id: "sample_decision",
      kind: "note",
      title: "Decision: postpone the Project Atlas launch to Q1",
      createdAt: decisionAt,
      tags: ["atlas", "decisions"],
      text: [
        "Decision: postpone the Project Atlas launch to Q1",
        "",
        "After today's review we decided to move the public launch of Atlas from late November to mid-January (Q1).",
        "",
        "Why:",
        "1. Payments still fail on about 3% of test checkouts — we won't launch with that.",
        "2. Support needs two more weeks of training on the new dashboard.",
        "3. The holiday code freeze starts Dec 15, which leaves no room for fixes after launch.",
        "4. Marketing would rather run a fresh new-year campaign than compete with Black Friday.",
        "",
        "What stays the same: the beta stays open for the 40 pilot customers, and pricing stays at $29/month.",
        `Owner: Daniel Kim. Next checkpoint: launch readiness review on ${fmtMonthDay(launchReview)}.`,
        "Decided with Maya Chen, Jordan Lee and Daniel Kim.",
        "",
        "#atlas #decisions",
      ].join("\n"),
    },
    {
      id: "sample_recipe",
      kind: "text",
      title: "One-pan lemon garlic chicken with crispy potatoes",
      createdAt: recipeAt,
      mimeType: "text/html",
      tags: ["recipes", "dinner"],
      text: [
        "One-Pan Lemon Garlic Chicken with Crispy Potatoes",
        "https://www.example.com/recipes/one-pan-lemon-garlic-chicken",
        "Serves 4 · Prep 15 min · Cook 40 min",
        "",
        "Ingredients",
        "- 6 bone-in, skin-on chicken thighs",
        "- 1½ lb (700 g) baby potatoes, halved",
        "- 2 lemons: zest and juice of one, the other sliced",
        "- 6 garlic cloves, smashed",
        "- 3 tbsp olive oil",
        "- 1 tsp smoked paprika",
        "- A few sprigs of fresh thyme",
        "- Salt and black pepper",
        "",
        "Method",
        "1. Heat the oven to 425°F (220°C).",
        "2. Toss the potatoes with 2 tbsp olive oil, salt and pepper, and spread them on a sheet pan.",
        "3. Rub the chicken with lemon zest, paprika, garlic, the rest of the oil, salt and pepper. Nestle it skin-side up between the potatoes with the lemon slices and thyme.",
        "4. Roast 35–40 minutes, until the skin is crisp and the chicken reaches 175°F (80°C).",
        "5. Squeeze over the lemon juice and rest 5 minutes before serving.",
        "",
        "Tip: pat the chicken skin really dry with paper towels — that's the secret to crispy skin.",
        "",
        "#recipes #dinner",
      ].join("\n"),
    },
    {
      id: "sample_chair",
      kind: "image",
      title: "Herman Miller Aeron chair — $1,395 at the Union Square showroom",
      createdAt: chairAt,
      sourceDate: chairAt - 3 * 60_000,
      sourceName: "IMG_4417.jpg",
      mimeType: "image/jpeg",
      width: 3024,
      height: 4032,
      ocrConfidence: 91,
      tags: ["shopping", "home-office"],
      text: [
        "Herman Miller",
        "Aeron Chair",
        "Size B · Graphite frame and base",
        "PostureFit SL back support",
        "Fully adjustable arms · Tilt limiter",
        "$1,395",
        "12-year warranty",
        "Union Square showroom",
        "Ask our team about the 10% trade discount",
      ].join("\n"),
    },
    {
      id: "sample_invoice",
      kind: "pdf",
      title: "Invoice #4821 — Northwind Studio ($2,340.00)",
      createdAt: invoiceAt,
      sourceDate: invoiceIssued,
      sourceName: "Invoice-4821.pdf",
      mimeType: "application/pdf",
      pageCount: 1,
      tags: ["finance"],
      text: [
        "Northwind Studio",
        "1200 Harbor Blvd, Suite 400 · Oakland, CA 94607",
        "billing@northwindstudio.co · +1 (510) 555-0199",
        "",
        "INVOICE #4821",
        `Due date: ${fmtDate(invoiceDue)}`,
        `Issue date: ${fmtDate(invoiceIssued)}`,
        "",
        "Bill to: Alex Morgan, Brightside Labs · alex@brightsidelabs.co",
        "",
        "Brand identity refresh — 1 × $1,600.00 = $1,600.00",
        "Landing page illustrations — 4 × $150.00 = $600.00",
        "Revision round (hours) — 2 × $70.00 = $140.00",
        "",
        "Subtotal: $2,340.00",
        "Tax (0%): $0.00",
        "Total due: $2,340.00",
        "",
        "Pay by bank transfer (account ending 4471) or by card at https://pay.example.com/northwind/4821",
        "A late fee of 1.5% per month applies after the due date. Thank you for your business!",
      ].join("\n"),
    },
    {
      id: "sample_meeting",
      kind: "voice",
      title: "Weekly sync — onboarding redesign",
      createdAt: meetingAt,
      sourceDate: meetingAt - 40 * 60_000,
      sourceName: "Weekly sync - onboarding.m4a",
      mimeType: "audio/mp4",
      durationSec: 312,
      tags: ["meetings"],
      text: [
        "Okay, let's get started. This is the weekly sync for the onboarding redesign. Jordan, do you want to go first?",
        "Sure. The new three-step onboarding is about eighty percent done. We cut the sign-up form from nine fields down to four, and the import step now shows a progress bar. I still need to finish the empty states.",
        "Great. Maya, any numbers from the beta?",
        "Yes. Activation in the beta group went from 31% to 44%, which is the biggest jump we've seen. Most people who drop off still do it on the import step, so the progress bar should help.",
        "Nice. On illustrations, I talked to Priya Sharma from Lumen Studio. She can do the full set of six illustrations for about $3,000 and deliver in three weeks. I'll send her the brief on Monday.",
        "Action items: Jordan finishes the empty states by Friday, Maya writes the help article on importing, and I'll confirm the illustration budget with finance.",
        "Next sync is Thursday at 10 a.m. Thanks, everyone.",
      ].join("\n\n"),
    },
    {
      id: "sample_contact",
      kind: "image",
      title: "Priya Sharma — contact card",
      createdAt: contactAt,
      sourceDate: contactAt - 60_000,
      sourceName: "IMG_5120.PNG",
      mimeType: "image/png",
      width: 1170,
      height: 2532,
      ocrConfidence: 94,
      tags: ["contacts", "design"],
      text: [
        "Contact",
        "Priya Sharma",
        "Product Designer · Lumen Studio",
        "San Francisco Bay Area",
        "mobile",
        "+1 (415) 555-0134",
        "email",
        "priya@lumen.studio",
        "website",
        "https://lumen.studio/priya",
        "notes",
        "Met at the design systems meetup. Open to freelance illustration work.",
      ].join("\n"),
    },
    {
      id: "sample_flight",
      kind: "pdf",
      title: `Flight SFO → JFK on ${fmtMonthDay(outbound)} — confirmation K7QX2M`,
      createdAt: flightAt,
      sourceDate: flightAt - 5 * 60_000,
      sourceName: "SkyBridge e-ticket K7QX2M.pdf",
      mimeType: "application/pdf",
      pageCount: 2,
      tags: ["travel"],
      text: [
        "SkyBridge Airlines — e-ticket receipt",
        "",
        "Your trip is confirmed",
        "Confirmation code: K7QX2M",
        "Passenger: Alex Morgan",
        "",
        `Outbound — ${fmtDay(outbound)}`,
        "Flight SB 482 · San Francisco (SFO) → New York (JFK)",
        "Departs 8:05 AM · Arrives 4:39 PM · Nonstop · 5h 34m",
        "Seat 14C · Economy · 1 checked bag included",
        "",
        `Return — ${fmtDay(inbound)}`,
        "Flight SB 517 · New York (JFK) → San Francisco (SFO)",
        "Departs 6:15 PM · Arrives 9:52 PM · Nonstop · 6h 37m",
        "Seat 22A · Economy",
        "",
        "Total paid: $412.60",
        "Check in online 24 hours before departure: https://skybridge.example.com/trips/K7QX2M",
        "Questions? Call +1 (800) 555-0142",
      ].join("\n"),
    },
  ];
}
