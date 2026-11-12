"use client";
// How the header, the tab bar's + button and the add sheet reach `lib/add-actions` without putting the ingest
// pipeline on the first-load path. The module is fetched while the browser is idle (and again the moment a
// pointer or finger heads for an add button), so by the time someone clicks it is already here and every
// action runs synchronously inside the click — browsers only open file pickers and read the clipboard during
// a user gesture. Until then the picker / dialog actions fall back to setting the same UI state directly.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ACCEPTED_FILE_TYPES } from "@/lib/ingest/detect";
import { addSheetOpen, filePickerRequest, quickAdd, recorderOpen } from "@/lib/ui-state";

type AddActions = typeof import("@/lib/add-actions");
type IngestModule = typeof import("@/lib/ingest");

let actions: AddActions | null = null;
let actionsLoading: Promise<AddActions> | null = null;

/** Load (once) and return `lib/add-actions`. */
export function loadAddActions(): Promise<AddActions> {
  if (actions) return Promise.resolve(actions);
  actionsLoading ??= import("@/lib/add-actions").then(
    (mod) => (actions = mod),
    (err: unknown) => {
      actionsLoading = null;
      throw err;
    },
  );
  return actionsLoading;
}

/** Start loading the add actions in the background (safe to call often). */
export function warmAddActions(): void {
  loadAddActions().catch(() => {
    /* retried on the next warm-up or click */
  });
}

let fallbackNonce = 0;
function requestPicker(request: { accept: string; capture?: "environment" | "user" }): void {
  filePickerRequest.set({ ...request, nonce: Date.now() + ++fallbackNonce });
  warmAddActions();
}

/** Open the file picker right away (any supported file, or photos & videos only). */
export function startUpload(kind: "any" | "media" = "any"): void {
  if (actions) actions.openUploadPicker(kind);
  else requestPicker({ accept: kind === "media" ? "image/*,video/*" : ACCEPTED_FILE_TYPES });
}

/** Open the camera on phones (the photo picker elsewhere). */
export function startCamera(): void {
  if (actions) actions.openCamera();
  else requestPicker({ accept: "image/*", capture: "environment" });
}

/** Save what's on the clipboard right away. */
export function startPaste(): void {
  const run = (mod: AddActions) =>
    mod.pasteNow().catch((err: unknown) => {
      console.warn("[remembos] paste failed", err);
      toast.error("Couldn't read the clipboard", {
        id: "paste-failed",
        description: "Press ⌘V (Mac) or Ctrl+V (Windows, Linux) anywhere in Remembos to paste instead.",
      });
    });
  if (actions) void run(actions);
  else
    void loadAddActions().then(run, () => {
      toast.error("Couldn't start pasting", { id: "paste-failed", description: "Please try again in a moment." });
    });
}

export function startRecording(): void {
  if (actions) actions.openRecorder();
  else recorderOpen.set(true);
}

export function startNote(): void {
  if (actions) actions.openNote();
  else quickAdd.set({ mode: "note" });
}

export function openSheet(): void {
  if (actions) actions.openAddSheet();
  else addSheetOpen.set(true);
}

// ---------- Touch detection (shows "Take photo") ----------

const COARSE = "(pointer: coarse)";

function subscribeCoarse(onChange: () => void): () => void {
  const media = window.matchMedia?.(COARSE);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}

/** Reactive version of `isTouchDevice()` from add-actions (false while prerendering). */
export function useIsTouchDevice(): boolean {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia?.(COARSE).matches === true,
    () => false,
  );
}

// ---------- Files arriving from outside (drop, picker, "Open with", share sheet) ----------

let ingestLoading: Promise<IngestModule> | null = null;
function loadIngest(): Promise<IngestModule> {
  ingestLoading ??= import("@/lib/ingest").catch((err: unknown) => {
    ingestLoading = null;
    throw err;
  });
  return ingestLoading;
}

/** Remember files (validation, duplicate and storage toasts come from ingest). Never throws. */
export async function rememberFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  try {
    const { ingestFiles } = await loadIngest();
    await ingestFiles(files);
  } catch (err) {
    try {
      const [{ isQuotaError }, { handleStorageError }] = await Promise.all([import("@/lib/db"), import("@/lib/storage/monitor")]);
      if (isQuotaError(err)) {
        handleStorageError(err, "adding files");
        return;
      }
    } catch {
      /* fall through to the generic message */
    }
    console.error("[remembos] could not add files", err);
    toast.error("Couldn't add those files", {
      id: "ingest-failed",
      description: "Something went wrong while reading them. Please try again.",
    });
  }
}
