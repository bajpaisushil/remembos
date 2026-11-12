// Ingest — turning dropped files, pasted things and typed notes into searchable memories, entirely on
// this device.
//
//   ingestFiles(files)      validate → create "processing" items at once (ms) → store originals + process in the background
//   ingestText(text, opts)  pasted text / typed notes, saved immediately (keyword-indexed right after)
//   pasteFromClipboard()    the Paste button: read the clipboard and save it right away
//   updateItemText(...)     edit a memory's text (re-chunks, re-extracts entities, re-indexes)
//   queueStore / useQueue   live jobs (stage + progress) for the processing dock
//   cancelJob / retryItem / resumeInterrupted / installPasteHandler (⌘V anywhere saves immediately)
//
// Pipeline per file: extract (image OCR · PDF text layer + OCR for scans · Whisper transcription · video:
// poster + transcript + OCR of sampled frames · text decoding) → thumbnail → chunkText → extractEntities →
// saveProcessedItem ("ready") → indexItem →
// embedItem (meaning search; its failure never fails the memory). Two files are processed at a time and
// only one AI model runs at a time.
export { queueStore, cancelJob, retryItem, resumeInterrupted, dismissJob, clearFinishedJobs } from "./queue";
export { ACCEPTED_FILE_TYPES, detectKind } from "./detect";
export { ingestFiles } from "./add-files";
export { ingestText, updateItemText } from "./save";
export { installPasteHandler, pasteFromClipboard } from "./paste";
export { IngestError } from "./errors";

/** Live processing queue for the UI (newest first). Finished jobs linger ~1 min (errors 5 min) then are pruned. */
export { useQueue } from "./queue-store";
