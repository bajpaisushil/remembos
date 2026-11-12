import type { Metadata } from "next";
import { Suspense } from "react";
import { LibraryView } from "@/components/memory/LibraryView";
import { LibrarySkeleton } from "@/components/memory/Skeletons";

export const metadata: Metadata = {
  title: "Library",
  description: "Browse every screenshot, PDF, video, voice note and note you've saved — filter, sort and tidy up. Stored only in this browser.",
};

/** /library/ — every memory as a grid or list. The view reads ?kind= / ?tag= on the client. */
export default function LibraryPage() {
  return (
    <Suspense fallback={<LibrarySkeleton />}>
      <LibraryView />
    </Suspense>
  );
}
