"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Waypoints } from "lucide-react";
import { Button, SectionHeader } from "@/components/ui";
import { ROUTES } from "@/lib/config";
import type { MemoryItem } from "@/lib/types";
import { MemoryCard } from "./MemoryCard";
import { queryRelated, type RelatedMemory } from "./memory-data";

/** Up to six memories that share the most people, numbers, links or topics with this one. */
export function RelatedMemories({ item }: { item: MemoryItem }) {
  const key = item.entityIds.join("|");
  const related = useLiveQuery<RelatedMemory[]>(async () => {
    try {
      return await queryRelated(item, 6);
    } catch {
      return [];
    }
  }, [item.id, key]);

  if (!related?.length) return null;

  return (
    <section aria-labelledby="related-heading" className="mt-12 sm:mt-16" data-testid="item-related">
      <SectionHeader
        id="related-heading"
        title="Related memories"
        description="They mention some of the same people, numbers, links or topics."
        actions={
          <Button href={ROUTES.graph} variant="ghost" size="sm" leftIcon={<Waypoints />}>
            See the graph
          </Button>
        }
      />
      <ul role="list" className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        {related.map((r) => (
          <li key={r.item.id} className="min-w-0">
            <MemoryCard
              item={r.item}
              chips={r.shared.slice(0, 3)}
              pinnable={false}
              className="h-full"
              note={
                r.shared.length > 3 ? (
                  <span>
                    Shares {r.shared.length} details with this memory
                  </span>
                ) : undefined
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
