"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Card, CardHeader, CopyButton, ENTITY_ICONS, EntityChip, SkeletonText } from "@/components/ui";
import { ENTITY_META, searchHref } from "@/lib/config";
import { db } from "@/lib/db";
import { ENTITY_TYPES, type Entity, type EntityType, type MemoryItem } from "@/lib/types";

const GROUP_LABELS: Record<EntityType, string> = {
  phone: "Phone numbers",
  email: "Emails",
  url: "Links",
  money: "Amounts",
  date: "Dates",
  name: "People, places & companies",
  topic: "Topics",
  tag: "Hashtags",
};

/** Precise values people come back to copy: shown as rows with a copy button. */
const COPYABLE = new Set<EntityType>(["phone", "email", "url", "money", "date"]);
const COLLAPSED = 10;

function Group({ type, list }: { type: EntityType; list: Entity[] }) {
  const [open, setOpen] = useState(false);
  const Icon = ENTITY_ICONS[type];
  const shown = open ? list : list.slice(0, COLLAPSED);
  const hidden = list.length - shown.length;
  const copyable = COPYABLE.has(type);
  const headingId = `entities-${type}`;

  return (
    <section aria-labelledby={headingId}>
      <h4 id={headingId} className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
        <Icon aria-hidden className={`size-3.5 ${ENTITY_META[type].color}`} />
        {GROUP_LABELS[type]}
        <span className="font-normal tabular-nums normal-case">· {list.length}</span>
      </h4>
      {copyable ? (
        <ul className="flex flex-col gap-1">
          {shown.map((e) => (
            <li key={e.id} className="flex min-w-0 items-center justify-between gap-1.5">
              <EntityChip
                type={type}
                value={e.value}
                href={searchHref(e.value)}
                count={e.itemIds.length}
                maxChars={34}
                data-testid="item-entity"
                className="min-w-0"
              />
              <CopyButton value={e.value} iconOnly label={`Copy ${e.value}`} className="shrink-0" />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((e) => (
            <EntityChip
              key={e.id}
              type={type}
              value={e.value}
              href={searchHref(e.value.replace(/^#/, ""))}
              count={e.itemIds.length}
              maxChars={30}
              data-testid="item-entity"
            />
          ))}
        </div>
      )}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
        >
          Show {hidden} more
        </button>
      ) : null}
    </section>
  );
}

/** "Found in this memory": phone numbers, emails, links, amounts, dates, names and topics, grouped. */
export function ItemEntities({ item }: { item: MemoryItem }) {
  const key = item.entityIds.join("|");
  const entities = useLiveQuery(async () => {
    if (!item.entityIds.length) return [] as Entity[];
    try {
      return (await db.entities.bulkGet(item.entityIds)).filter((e): e is Entity => Boolean(e));
    } catch {
      return [] as Entity[];
    }
  }, [item.id, key]);

  const userTags = new Set((item.tags ?? []).map((t) => t.toLowerCase()));
  const groups = ENTITY_TYPES.map((type) => ({
    type,
    list: (entities ?? []).filter((e) => e.type === type && !(type === "tag" && userTags.has(e.normalized))),
  })).filter((g) => g.list.length);

  return (
    <Card padding="sm" radius="2xl" data-testid="item-entities">
      <CardHeader
        icon={<Sparkles />}
        title="Found in this memory"
        description="Tap one to see every memory that mentions it."
      />
      <div className="mt-4 flex flex-col gap-4">
        {entities === undefined || (item.status === "processing" && !groups.length) ? (
          <SkeletonText lines={3} />
        ) : groups.length ? (
          groups.map((g) => <Group key={g.type} type={g.type} list={g.list} />)
        ) : (
          <p className="text-sm leading-relaxed text-muted">
            Nothing specific yet — no phone numbers, emails, links, amounts, dates or names were spotted. It&apos;s still searchable by
            its words.
          </p>
        )}
      </div>
    </Card>
  );
}
