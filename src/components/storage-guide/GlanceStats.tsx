"use client";

import { Brain, HardDrive, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Progress } from "@/components/ui/Progress";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatTile } from "@/components/ui/StatTile";
import { plural } from "@/lib/storage/helpers";
import { formatBytes } from "@/lib/utils";
import { KeepDataButton } from "./actions";
import { useInspection } from "./use-inspection";

/** Three live numbers under the hero: space used, memories saved, protection from clean-up. */
export function GlanceStats() {
  const { data } = useInspection();
  const est = data?.estimate;
  const tables = data?.indexedDB.tables;
  const persisted = data?.persisted;
  const canAsk = typeof navigator !== "undefined" && typeof navigator.storage?.persist === "function";

  return (
    <div className="mt-10 grid gap-3 sm:mt-12 sm:grid-cols-3" aria-busy={!data || undefined}>
      <StatTile
        label="Space used by this site"
        icon={<HardDrive />}
        tone="brand"
        data-testid="glance-usage"
        value={!data ? <Skeleton className="h-8 w-24" /> : est?.supported ? formatBytes(est.usage) : "—"}
        hint={
          !data ? (
            <Skeleton className="mt-1 h-3 w-36 rounded-full" />
          ) : est?.supported && est.quota ? (
            `of ${formatBytes(est.quota)} this browser allows`
          ) : (
            "This browser doesn't report it"
          )
        }
      >
        {data && est?.supported && est.quota ? <Progress value={est.usage / est.quota} tone="auto" size="sm" label="Storage used" /> : null}
      </StatTile>

      <StatTile
        label="Memories saved here"
        icon={<Brain />}
        tone="violet"
        data-testid="glance-memories"
        value={!data ? <Skeleton className="h-8 w-16" /> : tables ? tables.items.toLocaleString() : "—"}
        hint={
          !data ? (
            <Skeleton className="mt-1 h-3 w-32 rounded-full" />
          ) : !tables ? (
            "Couldn't open the vault right now"
          ) : tables.items === 0 ? (
            "Nothing saved yet — add your first memory"
          ) : (
            `${plural(tables.files, "original file", "original files")} · ${plural(tables.chunks, "search piece", "search pieces")}`
          )
        }
      />

      <StatTile
        label="Protected from auto clean-up"
        icon={persisted ? <ShieldCheck /> : persisted === false ? <ShieldAlert /> : <ShieldQuestion />}
        tone={!data ? "neutral" : persisted ? "emerald" : persisted === false ? "amber" : "neutral"}
        data-testid="glance-persisted"
        value={!data ? <Skeleton className="h-8 w-20" /> : persisted ? "Yes" : persisted === false ? "Not yet" : "Browser decides"}
        hint={
          !data ? (
            <Skeleton className="mt-1 h-3 w-40 rounded-full" />
          ) : persisted ? (
            "Your browser promised not to clear it on its own."
          ) : persisted === false ? (
            "The browser may clear it if the device runs low on space."
          ) : (
            "This browser doesn't say — keep a backup to be safe."
          )
        }
      >
        {data && persisted === false && canAsk ? <KeepDataButton size="sm" variant="soft" label="Ask to keep it" data-testid="glance-persist-button" /> : null}
      </StatTile>
    </div>
  );
}
