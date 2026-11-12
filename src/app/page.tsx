// Home is the upload area: a short promise, then one big panel to upload, paste, record or snap anything.
// Below the fold: the newest memories (live, with processing progress), what can be added, and the privacy
// promise. Search lives in the header (and /search/), not here.
import { DropZone } from "@/components/ingest/DropZone";
import { HomeGuide } from "@/components/ingest/HomeGuide";
import { HomeHero } from "@/components/ingest/HomeHero";
import { PrivacyCard } from "@/components/ingest/PrivacyCard";
import { RecentMemories } from "@/components/ingest/RecentMemories";
import { ToolTiles } from "@/components/ingest/ToolTiles";
import { Container } from "@/components/ui/PageHeader";

export default function Home() {
  return (
    <Container className="pb-6">
      <HomeHero />
      <DropZone />
      <HomeGuide />
      <div className="mt-12 flex flex-col gap-12 sm:mt-16 sm:gap-16">
        <RecentMemories />
        <ToolTiles />
        <PrivacyCard />
      </div>
    </Container>
  );
}
