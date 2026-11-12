// Paste = remember, instantly. ⌘V / Ctrl+V anywhere (or the Paste button) saves whatever is on the clipboard
// right away — no dialog:
//   • screenshots / images / files → the normal file pipeline (OCR, …) with a "reading text…" toast
//   • text and links → a "text" memory, saved in milliseconds, with an Undo + Open toast
// Pastes into text fields, and anything behind an open dialog, are left alone.
import { toast } from "sonner";
import { itemHref } from "../config";
import { db } from "../db";
import { deriveTitle } from "../nlp/chunk";
import { filePickerRequest, quickAdd } from "../ui-state";
import { truncate } from "../utils";
import { addFiles, prepareForFiles } from "./add-files";
import { extensionOf, isGenericName } from "./detect";
import { friendlyError, IngestError, isStorageError } from "./errors";
import { htmlToText } from "./extract-text";
import { navigate } from "./nav";
import { ingestText } from "./save";

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);
const TOAST_ID = "clipboard-paste";
/** The same text pasted again within this window is an accidental double paste, not a new memory. */
const REPEAT_WINDOW_MS = 15_000;

function isEditable(target: EventTarget | null): boolean {
  if (!target || typeof Element === "undefined" || !(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return !!target.closest("[contenteditable]:not([contenteditable='false'])");
}

/** A modal dialog (command palette, recorder, confirmations…) is open: ⌘V belongs to it, not to the page behind. */
function modalOpen(): boolean {
  return !!document.querySelector('[aria-modal="true"]:not([data-state="closed"])');
}

function clipboardFiles(data: DataTransfer): File[] {
  if (data.files && data.files.length) return Array.from(data.files);
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

function timestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

/** Clipboard images arrive as "image.png"; give them a dated name (their title then comes from the text found). */
function nameClipboardFile(file: File, index: number, when: Date): File {
  if (!file.type.startsWith("image/") || (file.name && !isGenericName(file.name))) return file;
  const ext = extensionOf(file.name) || file.type.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
  const suffix = index > 0 ? ` (${index + 1})` : "";
  return new File([file], `Pasted image ${timestamp(when)}${suffix}.${ext}`, {
    type: file.type,
    lastModified: when.getTime(),
  });
}

function addPastedFiles(files: File[]): void {
  const when = new Date();
  const named = files.map((f, i) => nameClipboardFile(f, i, when));
  const images = named.every((f) => f.type.startsWith("image/"));
  const loadingTitle = images
    ? named.length === 1
      ? "Pasted image — reading text…"
      : `Pasted ${named.length} images — reading text…`
    : undefined;
  void addFiles(named, { loadingTitle });
}

// ---------- text ----------

let lastSaved: { text: string; id: string; at: number } | null = null;

async function undoPaste(id: string): Promise<void> {
  if (lastSaved?.id === id) lastSaved = null;
  try {
    const { deleteItems } = await import("../storage/clear");
    await deleteItems([id]);
  } catch {
    /* deleteItems already explained what went wrong */
  }
}

/** Save pasted text/links as a "text" memory right away, with Undo + Open. */
async function saveClipboardText(raw: string): Promise<void> {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) return;

  const repeat = lastSaved;
  if (
    repeat &&
    repeat.text === text &&
    Date.now() - repeat.at < REPEAT_WINDOW_MS &&
    (await db.items.where("id").equals(repeat.id).count().catch(() => 0)) > 0
  ) {
    toast.info("Already saved from clipboard", {
      id: TOAST_ID,
      description: "You just pasted this — it's in your memories once.",
      action: { label: "Open", onClick: () => navigate(itemHref(repeat.id)) },
    });
    return;
  }

  const title = deriveTitle(text, "Pasted text");
  let id: string;
  try {
    id = await ingestText(text, { kind: "text", title });
  } catch (err) {
    // Storage problems were already explained by a storage toast.
    if (isStorageError(err) || (err instanceof IngestError && err.alreadyShown)) return;
    toast.error("Couldn't save what you pasted", { id: TOAST_ID, description: friendlyError(err) });
    return;
  }
  lastSaved = { text, id, at: Date.now() };
  toast.success("Saved from clipboard", {
    id: TOAST_ID,
    description: truncate(title, 90),
    action: { label: "Undo", onClick: () => void undoPaste(id) },
    cancel: { label: "Open", onClick: () => navigate(itemHref(id)) },
  });
}

// ---------- ⌘V anywhere ----------

/**
 * Install a document-level paste listener: images/files → ingestFiles, text/links → saved immediately.
 * Also gets the duplicate check ready as soon as someone starts dragging files in or opens a file picker,
 * so adding them is instant. Returns cleanup.
 */
export function installPasteHandler(): () => void {
  if (typeof document === "undefined") return () => {};

  const onPaste = (event: ClipboardEvent) => {
    if (event.defaultPrevented) return;
    if (isEditable(event.target) || isEditable(document.activeElement) || modalOpen()) return;
    const data = event.clipboardData;
    if (!data) return;

    const files = clipboardFiles(data);
    if (files.length) {
      event.preventDefault();
      addPastedFiles(files);
      return;
    }

    let text = data.getData("text/plain");
    if (!text.trim()) {
      const html = data.getData("text/html");
      if (html) text = htmlToText(html).text;
    }
    if (text.trim()) {
      event.preventDefault();
      void saveClipboardText(text);
    }
  };

  const onDragEnter = (event: DragEvent) => {
    if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) prepareForFiles();
  };

  document.addEventListener("paste", onPaste);
  window.addEventListener("dragenter", onDragEnter, { capture: true, passive: true });
  const stopPicker = filePickerRequest.subscribe(() => prepareForFiles());
  return () => {
    document.removeEventListener("paste", onPaste);
    window.removeEventListener("dragenter", onDragEnter, { capture: true });
    stopPicker();
  };
}

// ---------- the Paste button ----------

type ClipboardProblem = "blocked" | "unsupported" | "empty";

class ClipboardUnavailable extends Error {
  constructor(readonly problem: ClipboardProblem) {
    super(problem);
    this.name = "ClipboardUnavailable";
  }
}

function problemOf(err: unknown): ClipboardProblem {
  if (err instanceof ClipboardUnavailable) return err.problem;
  const name = (err as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "blocked";
  if (name === "TypeError" || name === "NotSupportedError") return "unsupported";
  return "blocked";
}

/** Images (as files) or text from the async Clipboard API; images win (a copied screenshot often carries an HTML twin). */
async function readClipboard(): Promise<{ files: File[]; text: string }> {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clip || (typeof clip.read !== "function" && typeof clip.readText !== "function")) {
    throw new ClipboardUnavailable("unsupported");
  }

  let readFailure: unknown;
  if (typeof clip.read === "function") {
    try {
      const items = await clip.read();
      const files: File[] = [];
      let plain = "";
      let html = "";
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/") && !t.includes("svg"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const type = blob.type || imageType;
          const ext = type.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
          // Named "Pasted image <date>.png" by addPastedFiles.
          files.push(new File([blob], `image.${ext}`, { type }));
          continue;
        }
        if (!plain && item.types.includes("text/plain")) plain = await (await item.getType("text/plain")).text();
        if (!html && item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
      }
      if (files.length) return { files, text: "" };
      if (plain.trim()) return { files: [], text: plain };
      if (html) {
        const fromHtml = htmlToText(html).text;
        if (fromHtml.trim()) return { files: [], text: fromHtml };
      }
      return { files: [], text: "" };
    } catch (err) {
      readFailure = err;
    }
  }
  if (typeof clip.readText === "function") {
    try {
      return { files: [], text: await clip.readText() };
    } catch (err) {
      throw readFailure ?? err;
    }
  }
  throw readFailure ?? new ClipboardUnavailable("unsupported");
}

function pasteShortcut(): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘V" : "Ctrl+V";
}

function isTouchFirst(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

function explainProblem(problem: ClipboardProblem): void {
  const touch = isTouchFirst();
  const keys = pasteShortcut();
  const openTextBox = { label: "Open text box", onClick: () => quickAdd.set({ mode: "text" }) };
  if (problem === "empty") {
    toast.info("Nothing to paste yet", {
      id: TOAST_ID,
      description: touch
        ? "Your clipboard is empty. Copy some text, a link or a screenshot first, then tap Paste again."
        : `Your clipboard is empty. Copy some text, a link or a screenshot first — then press ${keys} anywhere here.`,
    });
    return;
  }
  const why =
    problem === "blocked" ? "Your browser didn't let Remembos read the clipboard." : "This browser doesn't let websites read the clipboard.";
  toast.info(touch ? "Paste it in a text box instead" : `Press ${keys} to paste`, {
    id: TOAST_ID,
    description: touch
      ? `${why} Open the text box, touch and hold, then choose Paste — it's saved right away.`
      : `${why} Press ${keys} anywhere on this page instead — it's saved right away.`,
    action: openTextBox,
    duration: 9_000,
  });
}

/**
 * "Paste" button: read the clipboard (navigator.clipboard.read → images/files, else readText) and save
 * immediately — images go through ingestFiles (OCR), text/links are saved as a "text" memory with an
 * Undo + Open toast. When the browser blocks clipboard reading, explain how to press ⌘V / Ctrl+V instead.
 * Call it straight from the click handler (browsers only allow clipboard reads during a user gesture).
 */
export async function pasteFromClipboard(): Promise<void> {
  let content: { files: File[]; text: string };
  try {
    content = await readClipboard();
  } catch (err) {
    explainProblem(problemOf(err));
    return;
  }
  if (content.files.length) {
    addPastedFiles(content.files);
    return;
  }
  if (!content.text.trim()) {
    explainProblem("empty");
    return;
  }
  await saveClipboardText(content.text);
}
