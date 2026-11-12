// The per-file pipeline: extract → thumbnail → chunk → entities → save (status "ready") → keyword index.
// Embedding for meaning search happens afterwards in the queue, outside the processing slot.
import { extractGenericFile } from "./extract-file";
import { db } from "../db";
import { deriveSummary, deriveTitle } from "../nlp/chunk";
import { getSettings } from "../settings";
import type { MemoryItem } from "../types";
import { truncate } from "../utils";
import type { Extracted, ExtractContext } from "./context";
import { baseName, isGenericName } from "./detect";
import { abortError, IngestError, throwIfAborted } from "./errors";
import { extractVoice } from "./extract-audio";
import { extractImage } from "./extract-image";
import { extractPdf } from "./extract-pdf";
import { extractTextFile } from "./extract-text";
import { extractVideo } from "./extract-video";
import { readOriginal } from "./originals";
import { commitItem, countWords, indexAndEmbed, limitText } from "./save";

/** Longest stored summary (matches deriveSummary). */
const SUMMARY_MAX = 280;

export interface ProcessOutcome {
  item: MemoryItem;
  words: number;
  /** No text was found (or transcription is off). */
  empty: boolean;
  emptyNote?: string;
}

async function extract(item: MemoryItem, blob: Blob, ctx: ExtractContext): Promise<Extracted> {
  switch (item.kind) {
    case "image":
      return extractImage(blob, ctx);
    case "pdf":
      return extractPdf(blob, ctx);
    case "voice":
      return extractVoice(blob, ctx);
    case "video":
      return extractVideo(blob, ctx);
    case "file":
      return extractGenericFile(blob, item.sourceName ?? "", ctx);
    default:
      ctx.setStage("reading", "Reading text…");
      return extractTextFile(blob, item.sourceName ?? "", item.mimeType);
  }
}

/**
 * Files keep their file-name title, unless the person renamed the memory meanwhile, the file is a web
 * page with a real <title>, or the name says nothing ("image.png" from the clipboard) and text was found.
 */
function chooseTitle(current: MemoryItem, extracted: Extracted, text: string): string {
  const fileTitle = current.sourceName ? baseName(current.sourceName) : current.title;
  if (current.title !== fileTitle) return current.title;
  const pageTitle = extracted.title?.trim();
  if (pageTitle) return pageTitle.length > 120 ? `${pageTitle.slice(0, 119).trimEnd()}…` : pageTitle;
  if (current.sourceName && isGenericName(current.sourceName) && text.trim()) return deriveTitle(text, current.title);
  return current.title;
}

/** Process one stored item end to end. Resolves once it is saved as "ready" and keyword-searchable. */
export async function processStoredItem(itemId: string, ctx: ExtractContext): Promise<ProcessOutcome> {
  const item = await db.items.get(itemId);
  if (!item) throw abortError();
  const original = await readOriginal(itemId);
  if (!original) {
    throw new IngestError("The original file isn't stored any more, so it can't be read again. Drop the file again to re-add it.");
  }
  throwIfAborted(ctx.signal);

  const extracted = await extract(item, original.blob, ctx);
  throwIfAborted(ctx.signal);
  // A just-added file may still be being copied into storage: never mark it ready before its original is safe.
  if (original.written) await original.written;

  ctx.setStage("extracting", "Finding names, dates and links…");
  const { text, pages } = limitText(extracted.text.trim() ? extracted.text : "", extracted.pages);
  const hasText = text.trim().length > 0;
  const summary = hasText
    ? extracted.summaryNote
      ? truncate(`${extracted.summaryNote}. ${deriveSummary(text)}`, SUMMARY_MAX)
      : deriveSummary(text)
    : (extracted.emptyNote ?? "");

  const saved = await commitItem({
    itemId,
    text,
    pages,
    thumb: extracted.thumb,
    dropOriginal: !getSettings().keepOriginals,
    signal: ctx.signal,
    patch: (current) => ({
      status: "ready",
      kind: extracted.kind ?? current.kind,
      title: chooseTitle(current, extracted, text),
      summary,
      pageCount: extracted.pageCount ?? current.pageCount,
      durationSec: extracted.durationSec ?? current.durationSec,
      width: extracted.width ?? current.width,
      height: extracted.height ?? current.height,
      ocrConfidence: extracted.ocrConfidence,
    }),
  });
  throwIfAborted(ctx.signal);

  ctx.setStage("indexing", "Making it searchable…");
  await indexAndEmbed(itemId, false);
  return { item: saved, words: countWords(text), empty: !hasText, emptyNote: extracted.emptyNote };
}
