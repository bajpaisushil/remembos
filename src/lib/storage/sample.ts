/**
 * "Try sample memories" — demo content so first-time visitors can try search, smart answers and
 * the graph instantly. Samples are ordinary memories flagged `sample: true` (text only: no fake
 * image/PDF/audio files are stored), built through the same NLP → save → index → embed pipeline
 * as real memories, and can be removed in one go without touching anything the person added.
 */
import { toast } from "sonner";
import { searchHref } from "../config";
import { db, deleteItemsCascade, getMeta, saveProcessedItem, setMeta } from "../db";
import { chunkText, deriveSummary } from "../nlp/chunk";
import { extractEntities, normalizeEntity } from "../nlp/entities";
import { embedItem, indexItem, removeFromIndex } from "../search";
import { getSettings } from "../settings";
import type { Chunk, ChunkDraft, ExtractedEntity, MemoryItem } from "../types";
import { cleanText, truncate } from "../utils";
import { SAMPLE_IDS_META_KEY, plural } from "./helpers";
import { goTo, handleStorageError, refreshStorage } from "./monitor";
import { SAMPLE_QUESTION, buildSampleMemories, type SampleMemory } from "./sample-data";

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

function chunksFor(itemId: string, text: string): Chunk[] {
  let drafts: ChunkDraft[];
  try {
    drafts = chunkText(text);
  } catch {
    drafts = [{ index: 0, text, start: 0, end: text.length }];
  }
  return drafts.map((d) => ({ ...d, id: `${itemId}:${d.index}`, itemId }));
}

/** Entities from the text plus the memory's tags (deduped by id, like the extractor does). */
function entitiesFor(sample: SampleMemory): ExtractedEntity[] {
  let found: ExtractedEntity[] = [];
  try {
    found = extractEntities(sample.text);
  } catch {
    found = [];
  }
  const ids = new Set(found.map((e) => `${e.type}:${e.normalized}`));
  for (const tag of sample.tags) {
    let normalized = tag;
    try {
      normalized = normalizeEntity("tag", `#${tag}`) || tag;
    } catch {
      normalized = tag;
    }
    if (ids.has(`tag:${normalized}`)) continue;
    ids.add(`tag:${normalized}`);
    found.push({ type: "tag", value: `#${tag}`, normalized, count: 1, index: Math.max(0, sample.text.indexOf(`#${tag}`)) });
  }
  return found;
}

function summaryFor(text: string): string {
  try {
    return deriveSummary(text);
  } catch {
    return truncate(cleanText(text).replace(/\s+/g, " "), 280);
  }
}

function toItem(s: SampleMemory, now: number): MemoryItem {
  return {
    id: s.id,
    kind: s.kind,
    title: s.title,
    text: s.text,
    summary: summaryFor(s.text),
    createdAt: s.createdAt,
    updatedAt: now,
    sourceDate: s.sourceDate,
    sourceName: s.sourceName,
    mimeType: s.mimeType,
    size: utf8Bytes(s.text),
    status: "ready",
    hasFile: 0,
    hasThumb: 0,
    pageCount: s.pageCount,
    durationSec: s.durationSec,
    width: s.width,
    height: s.height,
    ocrConfidence: s.ocrConfidence,
    tags: s.tags,
    entityIds: [],
    pinned: 0,
    embedded: 0,
    sample: true,
  };
}

async function rememberSampleIds(ids: string[]): Promise<void> {
  try {
    const known = (await getMeta<string[]>(SAMPLE_IDS_META_KEY)) ?? [];
    await setMeta(SAMPLE_IDS_META_KEY, Array.from(new Set([...known, ...ids])));
  } catch {
    /* only used to keep demo items out of reminders */
  }
}

/** Embed one item at a time in the background; failures are fine (keyword search still works). */
function embedInBackground(ids: string[]): void {
  if (!ids.length || !getSettings().semanticSearch) return;
  void (async () => {
    for (const id of ids) {
      try {
        await embedItem(id);
      } catch {
        return; // model unavailable — backfillEmbeddings() picks these up later
      }
    }
  })();
}

const trySearchAction = () => ({ label: "Try a search", onClick: () => goTo(searchHref(SAMPLE_QUESTION)) });

/**
 * Create 10 realistic sample memories (a contact screenshot, an invoice, a decision note, a
 * meeting recording, a recipe, a flight booking…). Already-present samples are not duplicated.
 * Resolves with how many were added and shows a toast inviting a first search.
 * Rejects (after a storage-error toast) if saving fails.
 */
export async function loadSampleData(): Promise<number> {
  const now = Date.now();
  const samples = buildSampleMemories(new Date(now));
  let existing: Set<string>;
  try {
    existing = new Set(await db.items.where(":id").anyOf(samples.map((s) => s.id)).primaryKeys());
  } catch (err) {
    handleStorageError(err, "adding the sample memories");
    throw err;
  }
  const todo = samples.filter((s) => !existing.has(s.id));
  if (!todo.length) {
    toast.info("The sample memories are already here", {
      id: "sample-data",
      description: `Ask something like “${SAMPLE_QUESTION}”`,
      action: trySearchAction(),
    });
    return 0;
  }

  const added: string[] = [];
  try {
    for (const s of todo) {
      const item = toItem(s, now);
      await saveProcessedItem(item, chunksFor(item.id, s.text), entitiesFor(s));
      added.push(item.id);
      try {
        await indexItem(item.id);
      } catch {
        /* the index rebuilds from IndexedDB on the next search */
      }
    }
  } catch (err) {
    if (added.length) await rememberSampleIds(added);
    handleStorageError(err, "adding the sample memories");
    throw err;
  } finally {
    void refreshStorage();
  }

  await rememberSampleIds(added);
  embedInBackground(added);
  toast.success(`Added ${plural(added.length, "sample memory", "sample memories")} — try asking a question`, {
    id: "sample-data",
    description: `For example: “${SAMPLE_QUESTION}” or “invoice due date”. Remove the samples anytime from Your data.`,
    duration: 12_000,
    action: trySearchAction(),
  });
  return added.length;
}

/** Remove every memory flagged as a sample (cascade + search index). Resolves with the count removed. */
export async function removeSampleData(): Promise<number> {
  let ids: string[];
  try {
    ids = await db.items.filter((i) => i.sample === true).primaryKeys();
    if (ids.length) await deleteItemsCascade(ids);
    await setMeta(SAMPLE_IDS_META_KEY, []);
  } catch (err) {
    handleStorageError(err, "removing the sample memories");
    throw err;
  }
  if (!ids.length) {
    toast.info("No sample memories to remove", { id: "sample-data" });
    return 0;
  }
  removeFromIndex(ids);
  void refreshStorage();
  toast.success(`Removed ${plural(ids.length, "sample memory", "sample memories")}`, {
    id: "sample-data",
    description: "Your own memories weren't touched.",
  });
  return ids.length;
}
