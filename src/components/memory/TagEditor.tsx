"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Hash, Plus, X } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button, Card, CardHeader, Input } from "@/components/ui";
import { ROUTES } from "@/lib/config";
import { db } from "@/lib/db";
import type { MemoryItem } from "@/lib/types";
import { saveTags } from "./memory-data";

function splitTags(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((t) => t.replace(/^#+/, "").trim())
    .filter(Boolean);
}

/** Add and remove a memory's tags. Each tag links to the library filtered by it. */
export function TagEditor({ item }: { item: MemoryItem }) {
  const listId = useId();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const tags = item.tags ?? [];

  const known = useLiveQuery(async () => {
    try {
      return (await db.items.orderBy("tags").uniqueKeys()).filter((k): k is string => typeof k === "string");
    } catch {
      return [];
    }
  }, []);
  const suggestions = (known ?? []).filter((t) => !tags.includes(t)).slice(0, 50);

  async function save(next: string[]): Promise<boolean> {
    setBusy(true);
    const saved = await saveTags(item.id, next);
    setBusy(false);
    return saved !== null;
  }

  async function add(raw: string) {
    const parts = splitTags(raw);
    if (!parts.length) return;
    if (await save([...tags, ...parts])) setInput("");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void add(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "," && input.trim()) {
      e.preventDefault();
      void add(input);
    } else if (e.key === "Backspace" && !input && tags.length) {
      e.preventDefault();
      void save(tags.slice(0, -1));
    }
  }

  return (
    <Card padding="sm" radius="2xl" data-testid="item-tags">
      <CardHeader
        icon={<Hash />}
        title="Tags"
        description="Group memories your way. Tags are searchable and show up in the graph."
      />
      {tags.length ? (
        <ul className="mt-3.5 flex flex-wrap gap-1.5" aria-label="Tags">
          {tags.map((t) => (
            <li key={t}>
              <span className="inline-flex h-7 max-w-full items-center rounded-full border border-teal-500/25 bg-teal-500/10 pl-2.5 text-[13px] font-medium text-teal-800 dark:border-teal-400/25 dark:bg-teal-400/10 dark:text-teal-200">
                <Link
                  href={`${ROUTES.library}?tag=${encodeURIComponent(t)}`}
                  className="min-w-0 truncate rounded-sm hover:underline"
                  title={`Show all memories tagged #${t}`}
                >
                  <span className="text-teal-600/70 dark:text-teal-300/70">#</span>
                  {t}
                </Link>
                <button
                  type="button"
                  onClick={() => void save(tags.filter((x) => x !== t))}
                  disabled={busy}
                  aria-label={`Remove tag ${t}`}
                  data-testid="tag-remove"
                  className="ml-0.5 grid size-7 shrink-0 place-items-center rounded-full text-teal-700/70 transition-colors hover:bg-teal-500/15 hover:text-teal-900 disabled:opacity-50 dark:text-teal-200/70 dark:hover:text-white"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={onSubmit} className="mt-3.5 flex items-center gap-2">
        <Input
          size="sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={tags.length ? "Add another tag…" : "Add a tag, e.g. work"}
          aria-label="Add a tag"
          list={suggestions.length ? listId : undefined}
          maxLength={60}
          leftIcon={<Hash />}
          data-testid="tag-input"
          wrapperClassName="flex-1"
        />
        <Button type="submit" size="sm" variant="soft" leftIcon={<Plus />} loading={busy} disabled={!input.trim()} data-testid="tag-add">
          Add
        </Button>
        {suggestions.length ? (
          <datalist id={listId}>
            {suggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        ) : null}
      </form>
    </Card>
  );
}
