"use client";
/**
 * Getting a memory's original back out of this browser's storage: "Open original" (a new tab with
 * the browser's own viewer — PDF viewer, image, player) and "Download".
 *
 * The stored Blob is looked up as soon as the memory page opens (a cheap handle — IndexedDB keeps
 * the bytes on disk), so clicking can open the tab right away inside the click; popup blockers
 * only allow new tabs opened directly from a click.
 */
import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { extensionFor } from "@/lib/storage/helpers";
import { handleStorageError } from "@/lib/storage/monitor";
import type { MemoryItem } from "@/lib/types";
import { downloadBlob } from "@/lib/utils";
import { downloadName } from "./memory-data";

/**
 * How long a tab's object URL stays valid. The viewer has loaded it long before then, but the
 * browser's PDF viewer reads it again for its own Download / Print buttons.
 */
const OPEN_URL_LIFETIME_MS = 10 * 60_000;

/** Types a browser tab shows by itself without running anything from the file. */
const SHOW_AS_IS = /^(image\/(png|jpe?g|pjpeg|gif|webp|avif|bmp|x-ms-bmp|heic|heif|tiff)|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+)$/;

/** Text-like types (plain, HTML, SVG, Markdown, CSV, JSON…) — shown as UTF-8 plain text so nothing in them can run. */
const SHOW_AS_TEXT = /^(text\/[\w.+-]+|image\/svg\+xml|application\/(json|xml|xhtml\+xml|rtf|x-rtf|ld\+json|x-subrip)|[\w.-]+\/[\w.-]+\+(json|xml))$/;

const TEXT_EXT = /\.(txt|text|md|markdown|csv|tsv|json|html?|xml|log|rtf|vcf|vtt|srt|svg)$/i;

function baseType(type: string | undefined): string {
  return (type ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * The stored blob, re-typed so a browser tab can show it safely, or null when a tab can't show it
 * (then the file is downloaded instead). HTML or SVG are shown as source text: a blob URL runs with
 * this site's permissions, so active content must never be rendered from it.
 */
export function viewableBlob(blob: Blob, mimeType?: string, sourceName?: string): Blob | null {
  const type = baseType(blob.type) || baseType(mimeType);
  if (SHOW_AS_IS.test(type)) return baseType(blob.type) === type ? blob : blob.slice(0, blob.size, type);
  if (SHOW_AS_TEXT.test(type) || (!type && sourceName && TEXT_EXT.test(sourceName))) {
    return blob.slice(0, blob.size, "text/plain;charset=utf-8");
  }
  return null;
}

/**
 * The stored original of a memory, loaded when the page opens. `undefined` while looking, null when there is
 * none (yet — right after a big file is added its original is still being written in the background, so the
 * row is followed live and the blob appears as soon as it lands).
 */
export function useStoredOriginal(itemId: string, hasFile: 0 | 1): Blob | null | undefined {
  const [state, setState] = useState<{ key: string; blob: Blob | null } | null>(null);
  const key = `${itemId}:${hasFile}`;
  useEffect(() => {
    if (!hasFile) return;
    const subscription = liveQuery(() => db.files.get(itemId)).subscribe({
      next: (f) => setState((prev) => {
        const blob = f?.blob ?? null;
        if (prev?.key === key && prev.blob && blob && prev.blob.size === blob.size && prev.blob.type === blob.type) return prev;
        return { key, blob };
      }),
      error: () => setState({ key, blob: null }),
    });
    return () => subscription.unsubscribe();
  }, [itemId, hasFile, key]);
  if (!hasFile) return null;
  return state?.key === key ? state.blob : undefined;
}

async function readOriginal(itemId: string): Promise<Blob | null> {
  const stored = await db.files.get(itemId);
  return stored?.blob ?? null;
}

function fileName(item: Pick<MemoryItem, "title" | "sourceName" | "mimeType">): string {
  return downloadName(item, extensionFor(item.mimeType, item.sourceName));
}

function missingOriginal(item: Pick<MemoryItem, "status">): void {
  if (item.status === "processing") {
    toast.info("Still saving the original…", {
      id: "memory-original",
      description: "It's being written into this browser's storage right now — try again in a moment.",
    });
    return;
  }
  toast.error("The original isn't stored any more", {
    id: "memory-original",
    description: "It was removed to save space. The text is still here and searchable.",
  });
}

/** Let go of our page from the new tab (it only ever shows the user's own file). */
function detach(tab: Window): void {
  try {
    tab.opener = null;
  } catch {
    /* some browsers make `opener` read-only — nothing to protect then */
  }
}

/** Point an already-open tab at a blob and keep its URL alive for a while. False when the tab is gone. */
function showInTab(tab: Window, blob: Blob): boolean {
  if (tab.closed) return false;
  const url = URL.createObjectURL(blob);
  try {
    tab.location.replace(url);
  } catch {
    URL.revokeObjectURL(url);
    return false;
  }
  window.setTimeout(() => URL.revokeObjectURL(url), OPEN_URL_LIFETIME_MS);
  return true;
}

function openBlockedToast(item: MemoryItem, blob: Blob, closed = false): void {
  toast.warning(closed ? "The new tab closed before the file opened" : "Your browser blocked the new tab", {
    id: "memory-original",
    description: closed ? "Try Open original again, or download the file instead." : "Allow pop-ups for this site, or download the file instead.",
    action: { label: "Download", onClick: () => downloadBlob(blob, fileName(item)) },
  });
}

/**
 * Open the original in a new tab with the browser's own viewer (PDFs open in the PDF viewer).
 * Pass the already-loaded blob from `useStoredOriginal` so the tab opens inside the click; without
 * it a blank tab opens at once and the file follows a moment later. Types a tab can't show are
 * downloaded instead.
 */
export async function openOriginal(item: MemoryItem, preloaded?: Blob | null): Promise<void> {
  if (preloaded) {
    const viewable = viewableBlob(preloaded, item.mimeType, item.sourceName);
    if (!viewable) {
      downloadBlob(preloaded, fileName(item));
      toast.info("Downloaded instead", {
        id: "memory-original",
        description: "Browsers can't show this kind of file in a tab, so it was saved to your downloads.",
      });
      return;
    }
    const url = URL.createObjectURL(viewable);
    const tab = window.open(url, "_blank");
    if (!tab) {
      URL.revokeObjectURL(url);
      openBlockedToast(item, preloaded);
      return;
    }
    detach(tab);
    window.setTimeout(() => URL.revokeObjectURL(url), OPEN_URL_LIFETIME_MS);
    return;
  }

  // Not loaded yet: open the tab now (still inside the click) and fill it once the file is read.
  const tab = window.open("about:blank", "_blank");
  let blob: Blob | null;
  try {
    blob = item.hasFile ? await readOriginal(item.id) : null;
  } catch (err) {
    tab?.close();
    handleStorageError(err, "opening the original file");
    return;
  }
  if (!blob) {
    tab?.close();
    missingOriginal(item);
    return;
  }
  const viewable = viewableBlob(blob, item.mimeType, item.sourceName);
  if (!viewable) {
    tab?.close();
    downloadBlob(blob, fileName(item));
    return;
  }
  if (!tab) {
    openBlockedToast(item, blob);
    return;
  }
  detach(tab);
  if (!showInTab(tab, viewable)) openBlockedToast(item, blob, true);
}

/** Save the original (with its own file name) — or, for notes and pasted text, the text itself. */
export async function downloadOriginal(item: MemoryItem, preloaded?: Blob | null): Promise<void> {
  try {
    const blob = preloaded ?? (item.hasFile ? await readOriginal(item.id) : null);
    if (blob) {
      downloadBlob(blob, fileName(item));
      return;
    }
    if (item.hasFile && item.status === "processing") {
      missingOriginal(item);
      return;
    }
    if (item.text) {
      const ext = item.kind === "note" ? "md" : "txt";
      const name = downloadName({ title: item.title, sourceName: undefined }, ext);
      downloadBlob(new Blob([item.text], { type: ext === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" }), name);
      return;
    }
    toast.error("Nothing to download", {
      id: "memory-download",
      description: "The original file isn't stored any more and this memory has no text.",
    });
  } catch (err) {
    handleStorageError(err, "reading the original file");
  }
}
