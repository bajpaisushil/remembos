/**
 * Open or download a stored file straight from IndexedDB.
 *
 * Opening uses an object URL in a new tab. Anything a browser would run as a web page (HTML, SVG,
 * XML…) is shown as plain text instead, so a saved file can never run code inside Remembos.
 * The click happens synchronously in the user's gesture (the Blob handle is already loaded), so
 * pop-up blockers don't interfere.
 */
import { toast } from "sonner";
import { safeOpenType } from "@/lib/storage-inspect";
import { downloadBlob } from "@/lib/utils";

/** Long enough for any viewer (PDF, video seeking) in the new tab; short enough not to pile up. */
const OPEN_URL_LIFETIME_MS = 30 * 60_000;

export function openBlobInNewTab(blob: Blob): void {
  try {
    const type = safeOpenType(blob.type);
    const viewable = type === blob.type ? blob : new Blob([blob], { type });
    const url = URL.createObjectURL(viewable);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), OPEN_URL_LIFETIME_MS);
  } catch {
    toast.error("Couldn't open the file", { id: "explorer-open", description: "Try Download instead — it saves a normal copy you can open." });
  }
}

export function downloadStoredBlob(blob: Blob, name: string): void {
  try {
    downloadBlob(blob, name);
  } catch {
    toast.error("Couldn't start the download", { id: "explorer-download", description: "Your browser blocked it. Try again, or open the file and save it from there." });
  }
}
