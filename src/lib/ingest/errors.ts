// Error helpers for ingest: user-facing messages, cancellation, and storage-error detection.
import Dexie from "dexie";
import { isQuotaError } from "../db";

/** An error whose message is already written for people (shown on the item and in toasts). */
export class IngestError extends Error {
  /** A toast explaining this problem was already shown (callers shouldn't show another one). */
  readonly alreadyShown: boolean;

  constructor(message: string, opts?: { alreadyShown?: boolean }) {
    super(message);
    this.name = "IngestError";
    this.alreadyShown = !!opts?.alreadyShown;
  }
}

/** Thrown when the user cancels a job. */
export function abortError(): Error {
  if (typeof DOMException === "function") return new DOMException("Cancelled", "AbortError");
  const err = new Error("Cancelled");
  err.name = "AbortError";
  return err;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

export function isAbortError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "AbortError";
}

/** Quota, blocked or broken IndexedDB — anything `handleStorageError` knows how to explain. */
export function isStorageError(err: unknown): boolean {
  if (isQuotaError(err)) return true;
  if (err instanceof Dexie.DexieError) return true;
  const name = (err as { name?: string } | null)?.name;
  return name === "InvalidStateError" || name === "UnknownError" || name === "DataCloneError" || name === "DataError";
}

/** Turn any failure into a short sentence a non-technical person understands. */
export function friendlyError(err: unknown): string {
  if (err instanceof IngestError) return err.message;
  if (isQuotaError(err)) return "Not enough storage space to save this. Free up some space, then retry.";
  const name = (err as { name?: string } | null)?.name;
  if (name === "PasswordException") return "This PDF is password-protected. Remove the password, then add it again.";
  if (name === "InvalidPDFException") return "This PDF looks damaged or isn't really a PDF.";
  if (name === "EncodingError") return "This file couldn't be decoded — it may be damaged or in an unsupported format.";
  if (isStorageError(err)) return "Your browser's storage refused to save this. Check Your data, then retry.";
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You seem to be offline, and a one-time download is needed to read this. Reconnect, then retry.";
  }
  return "Something went wrong while reading this file. Retry, or try a different copy of the file.";
}
