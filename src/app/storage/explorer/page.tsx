import type { Metadata } from "next";
import { Suspense } from "react";
import { ExplorerIntro, ExplorerSkeleton } from "@/components/storage-guide/explorer/ExplorerChrome";
import { StorageExplorer } from "@/components/storage-guide/explorer/StorageExplorer";
import { Container } from "@/components/ui/PageHeader";

export const metadata: Metadata = {
  title: "Storage explorer",
  description:
    "Browse every record Remembos keeps in this browser's IndexedDB — memories, original files, previews, search pieces and things found — and see exactly where one memory is stored on this device. Read-only.",
};

/** /storage/explorer/ — read-only IndexedDB explorer. `?item=<id>` focuses one memory, `?table=<name>` picks a table. */
export default function StorageExplorerPage() {
  return (
    <div data-testid="storage-explorer" className="relative isolate">
      <Container className="pt-8 pb-12 sm:pt-12">
        <ExplorerIntro />
        <Suspense fallback={<ExplorerSkeleton />}>
          <StorageExplorer />
        </Suspense>
      </Container>
    </div>
  );
}
