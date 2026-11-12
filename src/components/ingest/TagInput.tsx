"use client";

import { Hash, X } from "lucide-react";
import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export const MAX_TAGS = 12;
const MAX_TAG_CHARS = 32;

/** "#Work Trip " → "work-trip". Lower-case, no '#', spaces become dashes. */
export function normalizeTag(raw: string): string {
  return raw
    .replace(/^#+/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[,#]+/g, "")
    .slice(0, MAX_TAG_CHARS);
}

/** Merge comma/newline separated `raw` text into `tags` (deduped, capped). */
export function addTags(tags: string[], raw: string): string[] {
  const next = tags.slice();
  for (const part of raw.split(/[,\n]+/)) {
    const tag = normalizeTag(part);
    if (tag && !next.includes(tag) && next.length < MAX_TAGS) next.push(tag);
  }
  return next;
}

export interface TagInputProps {
  id?: string;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  /** Text typed but not yet turned into a chip (kept by the parent so saving can include it). */
  pending: string;
  onPendingChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
  "data-testid"?: string;
}

/** Tags field: type a tag and press Enter or comma to turn it into a chip; Backspace removes the last one. */
export function TagInput({
  id,
  tags,
  onTagsChange,
  pending,
  onPendingChange,
  placeholder = "Add a tag…",
  disabled,
  "aria-describedby": describedBy,
  "data-testid": testId,
}: TagInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const full = tags.length >= MAX_TAGS;

  function commit(raw: string) {
    if (!raw.trim()) return;
    onTagsChange(addTags(tags, raw));
    onPendingChange("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    // Plain Enter or comma adds the tag (and never submits the surrounding form); ⌘/Ctrl+Enter bubbles up to save.
    if (e.key === "," || (e.key === "Enter" && !e.metaKey && !e.ctrlKey)) {
      e.preventDefault();
      commit(pending);
    } else if (e.key === "Backspace" && !pending && tags.length) {
      e.preventDefault();
      onTagsChange(tags.slice(0, -1));
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (!/[,\n]/.test(text)) return;
    e.preventDefault();
    commit(pending + text);
  }

  function remove(tag: string) {
    onTagsChange(tags.filter((t) => t !== tag));
    inputRef.current?.focus();
  }

  return (
    <div
      data-testid={testId}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }}
      className={cn(
        "flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-xl border bg-white px-2 py-1.5 shadow-[0_1px_2px_rgb(20_20_43/0.04)]",
        "border-zinc-200/90 transition-[border-color,box-shadow] duration-150 ease-out hover:border-zinc-300",
        "focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/15",
        "dark:border-white/10 dark:bg-white/[0.05] dark:hover:border-white/20 dark:focus-within:border-brand-400/70 dark:focus-within:ring-brand-400/20",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex h-7 max-w-full items-center gap-1 rounded-lg bg-brand-500/10 pr-1 pl-2 text-[13px] font-medium text-brand-700 ring-1 ring-brand-500/20 ring-inset dark:bg-brand-400/15 dark:text-brand-200 dark:ring-brand-400/25"
        >
          <Hash aria-hidden className="size-3 shrink-0 opacity-70" />
          <span className="truncate">{tag}</span>
          <button
            type="button"
            onClick={() => remove(tag)}
            aria-label={`Remove tag ${tag}`}
            className="grid size-5 shrink-0 place-items-center rounded-md transition-colors hover:bg-brand-500/15 dark:hover:bg-brand-400/20"
          >
            <X aria-hidden className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={pending}
        onChange={(e) => {
          const value = e.target.value;
          // Typing a comma (or pasting one on mobile keyboards) commits what came before it.
          if (value.includes(",")) commit(value);
          else onPendingChange(value);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => commit(pending)}
        placeholder={full ? `Up to ${MAX_TAGS} tags` : tags.length ? "Add another…" : placeholder}
        disabled={disabled}
        aria-describedby={describedBy}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="enter"
        className="h-7 min-w-[8rem] flex-1 bg-transparent px-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed dark:text-zinc-100 dark:placeholder:text-zinc-500"
      />
    </div>
  );
}
