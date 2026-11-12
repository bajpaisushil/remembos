import type { Metadata } from "next";
import { Suspense } from "react";
import { GraphPageHeader } from "@/components/graph/GraphPageHeader";
import { GraphScreen } from "@/components/graph/GraphScreen";
import { GraphStageLoading } from "@/components/graph/GraphStates";
import { Container } from "@/components/ui/PageHeader";

export const metadata: Metadata = {
  title: "Graph",
  description:
    "See how your memories connect: the people, numbers, links, dates and tags they share, drawn as an interactive map. Built and stored only in your browser.",
};

/** /graph/ — the knowledge graph. `?focus=<id>` shows one memory's (or name's) connections. */
export default function GraphPage() {
  return (
    <Container className="flex min-h-[calc(100dvh-var(--header-h)-var(--app-bottom-inset))] flex-col pt-6 pb-4 sm:pt-8 sm:pb-6">
      <GraphPageHeader />
      {/* useSearchParams (for ?focus=) needs a Suspense boundary for the static export. */}
      <Suspense fallback={<GraphStageLoading />}>
        <GraphScreen />
      </Suspense>
    </Container>
  );
}
