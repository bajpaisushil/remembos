// Opening the file picker for one kind of file. The shell's GlobalDropOverlay owns the one hidden
// <input type="file"> and opens it synchronously whenever `filePickerRequest` changes, so calling
// `requestFiles()` inside a click handler keeps the browser's user-activation. For "any file" use
// `openUploadPicker()` from lib/add-actions.
import { ACCEPTED_FILE_TYPES } from "@/lib/ingest/detect";
import type { MemoryKind } from "@/lib/types";
import { filePickerRequest } from "@/lib/ui-state";

/** `accept` lists per file-based kind (notes are typed, so they have none). */
export const KIND_ACCEPT: Record<Exclude<MemoryKind, "note">, string> = {
  image: "image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.heic,.heif",
  pdf: "application/pdf,.pdf",
  video: "video/*,.mp4,.mov,.m4v,.webm,.qt",
  file: "", // any file type
  voice: "audio/*,video/webm,.m4a,.mp3,.wav,.ogg,.oga,.opus,.webm,.flac,.aac,.vtt,.srt",
  text: "text/plain,text/markdown,text/csv,text/html,application/json,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.log,.vcf,.rtf",
};

let nonce = 0;

/** Ask the global picker to open. Call from a click/keyboard handler. Defaults to every supported type. */
export function requestFiles(accept: string = ACCEPTED_FILE_TYPES): void {
  filePickerRequest.set({ accept, nonce: ++nonce + Math.random() });
}
