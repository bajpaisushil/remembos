import type { Metadata } from "next";
import { Suspense } from "react";
import { ItemView } from "@/components/memory/ItemView";
import { ItemSkeleton } from "@/components/memory/Skeletons";

export const metadata: Metadata = {
  title: "Memory",
  description: "One memory with its original, its text, what was found in it and related memories — all on this device.",
};

/** /item/?id=… — one memory. The id is read on the client (static export has no dynamic routes). */
export default function ItemPage() {
  return (
    <Suspense fallback={<ItemSkeleton />}>
      <ItemView />
    </Suspense>
  );
}
