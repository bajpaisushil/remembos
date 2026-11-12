"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { db } from "@/lib/db";
import { useMounted } from "@/lib/hooks";
import { updateSettings, useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { trySampleMemories } from "./samples";

/** Memory count, only while the tip could still be shown (a cheap indexed count, live). */
function useCountWhile(enabled: boolean): number | undefined {
  return useLiveQuery(async () => {
    if (!enabled) return undefined;
    try {
      return await db.items.count();
    } catch {
      return undefined;
    }
  }, [enabled]);
}

/**
 * First-visit tip under the upload panel: "New here? Drop anything above — or try sample memories".
 * Inline and dismissible — never a modal, never in the way of the upload area. Shown only until it is
 * dismissed (settings.onboarded) or the first memory arrives; client-only, so returning visitors never see
 * it flash in.
 */
export function HomeGuide() {
  const mounted = useMounted();
  const { onboarded } = useSettings();
  const count = useCountWhile(mounted && !onboarded);
  const [loading, setLoading] = useState(false);

  // Something is stored now (dropped, pasted, recorded or the samples): the welcome tip has done its job.
  useEffect(() => {
    if (!onboarded && count !== undefined && count > 0) updateSettings({ onboarded: true });
  }, [onboarded, count]);

  if (!mounted || onboarded || count !== 0) return null;

  async function trySamples() {
    setLoading(true);
    try {
      await trySampleMemories();
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside
      aria-label="Getting started"
      data-testid="home-guide"
      className={cn(
        "mx-auto mt-4 flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border py-2.5 pr-2 pl-3.5 sm:mt-5 sm:flex-nowrap",
        "border-brand-500/20 bg-brand-50/80 shadow-soft dark:border-brand-400/20 dark:bg-brand-400/10",
        "animate-slide-up motion-reduce:animate-none",
      )}
    >
      <Sparkles aria-hidden className="size-4 shrink-0 text-brand-600 dark:text-brand-300" />
      <p className="min-w-0 flex-1 basis-48 text-sm leading-snug text-zinc-700 dark:text-zinc-200">
        <strong className="font-semibold text-zinc-900 dark:text-white">New here?</strong> Drop anything above — or try
        sample memories.
      </p>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="soft"
          loading={loading}
          onClick={() => void trySamples()}
          data-testid="try-samples"
        >
          {loading ? "Adding samples…" : "Try sample memories"}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Dismiss this tip"
          onClick={() => updateSettings({ onboarded: true })}
          data-testid="home-guide-dismiss"
        >
          <X />
        </Button>
      </div>
    </aside>
  );
}
