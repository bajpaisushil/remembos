// The ways to add something to Remembos. Every "add" entry point in the UI (header Upload button + menu,
// mobile add sheet, home upload panel, command palette) calls these so behaviour stays identical everywhere.
import { ACCEPTED_FILE_TYPES } from "./ingest/detect";
import { addSheetOpen, filePickerRequest, quickAdd, recorderOpen } from "./ui-state";

type PasteModule = typeof import("./ingest/paste");

// The clipboard reader is fetched as soon as this module loads (in the browser) so that by the time someone
// presses Paste it can run synchronously inside the click — some browsers only allow reading the clipboard
// during the user's gesture.
let pasteModule: PasteModule | null = null;
let pasteLoading: Promise<PasteModule> | null = null;

function loadPaste(): Promise<PasteModule> {
  if (pasteModule) return Promise.resolve(pasteModule);
  pasteLoading ??= import("./ingest/paste").then(
    (mod) => (pasteModule = mod),
    (err: unknown) => {
      pasteLoading = null;
      throw err;
    },
  );
  return pasteLoading;
}

if (typeof window !== "undefined") {
  loadPaste().catch(() => {
    /* retried when Paste is pressed */
  });
}

let nonce = 0;

/** Open the system file picker right away (any supported file, or photos/videos only). */
export function openUploadPicker(kind: "any" | "media" = "any"): void {
  const accept = kind === "media" ? "image/*,video/*" : ACCEPTED_FILE_TYPES;
  filePickerRequest.set({ accept, nonce: ++nonce });
}

/** Open the camera directly on phones (falls back to the photo picker on desktop). */
export function openCamera(): void {
  filePickerRequest.set({ accept: "image/*", capture: "environment", nonce: ++nonce });
}

/** Read the clipboard and save it immediately (images → OCR, text/links → saved as-is). */
export function pasteNow(): Promise<void> {
  if (pasteModule) return pasteModule.pasteFromClipboard();
  return loadPaste().then((mod) => mod.pasteFromClipboard());
}

export function openRecorder(): void {
  recorderOpen.set(true);
}

/** Secondary: type a note. */
export function openNote(): void {
  quickAdd.set({ mode: "note" });
}

export function openAddSheet(): void {
  addSheetOpen.set(true);
}

/** True on touch-first devices (show "Take photo"). */
export function isTouchDevice(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}
