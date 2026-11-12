// "Try sample memories" — shared by the first-visit tip and the empty "Recent memories" strip.
// The sample content is imported on demand so it never weighs on the first page load.
import { toast } from "sonner";
import { updateSettings } from "@/lib/settings";

function isChunkLoadError(err: unknown): boolean {
  return (
    (err as { name?: string } | null)?.name === "ChunkLoadError" ||
    /dynamically imported module|Loading chunk|Importing a module script failed/i.test(String(err))
  );
}

/** Add the ten sample memories. Resolves true when they were added (or were already there). */
export async function trySampleMemories(): Promise<boolean> {
  try {
    const { loadSampleData } = await import("@/lib/storage/sample");
    await loadSampleData();
    // Trying the samples counts as getting started: the first-visit tip has done its job.
    updateSettings({ onboarded: true });
    return true;
  } catch (err) {
    // loadSampleData explains storage problems in a toast itself; a failed download of its code does not.
    if (isChunkLoadError(err)) {
      toast.error("Couldn't load the samples", { id: "sample-data", description: "Check your connection and try again." });
    }
    return false;
  }
}
