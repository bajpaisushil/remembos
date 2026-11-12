import { Search } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchScreen, SearchScreenFallback } from "@/components/search/SearchScreen";
import { Accent, Container, PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Search",
  description:
    "Ask your private memory anything — exact words and similar meaning, smart answers like phone numbers and amounts. Runs entirely in your browser.",
};

/** /search/?q=… — ask your memory. The question is read from the URL on the client (static export). */
export default function SearchPage() {
  return (
    <Container size="sm" className="pt-8 pb-16 sm:pt-14 sm:pb-24">
      <PageHeader
        align="center"
        eyebrow={
          <>
            <Search aria-hidden /> Search
          </>
        }
        title={
          <>
            Ask your <Accent>memory</Accent>
          </>
        }
        description="Type a question in your own words. Every screenshot, PDF, video, voice note and note on this device is searched — privately."
      />
      <Suspense fallback={<SearchScreenFallback />}>
        <SearchScreen />
      </Suspense>
    </Container>
  );
}
