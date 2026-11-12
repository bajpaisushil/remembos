// The "Paste" buttons on the home page. Reading the clipboard and saving happens in lib/ingest (which also
// explains blocked clipboard access); this only catches the unexpected so a click never fails silently.
import { toast } from "sonner";
import { pasteNow } from "@/lib/add-actions";

function modKey(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
}

/** Save whatever is on the clipboard right now. Call from a click handler (clipboard access needs one). */
export async function pasteFromButton(): Promise<void> {
  try {
    await pasteNow();
  } catch (err) {
    console.warn("[remembos] paste failed", err);
    toast.error("Couldn't paste from the clipboard", {
      id: "paste-failed",
      description: `Press ${modKey()}+V anywhere on the page to paste instead.`,
    });
  }
}
