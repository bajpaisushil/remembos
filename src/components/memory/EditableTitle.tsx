"use client";

import { Check, Pencil } from "lucide-react";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button, fieldBaseClasses } from "@/components/ui";
import { cn } from "@/lib/utils";
import { saveTitle } from "./memory-data";

export interface EditableTitleProps {
  itemId: string;
  title: string;
  className?: string;
}

/** The memory's title as the page heading; click it (or the pencil) to rename. Enter saves, Esc cancels. */
export function EditableTitle({ itemId, title, className }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  /** Set once an edit session ends, so the blur that follows Enter/Esc doesn't save again. */
  const settled = useRef(false);

  function start() {
    settled.current = false;
    setDraft(title);
    setEditing(true);
  }

  function cancel() {
    settled.current = true;
    setEditing(false);
  }

  async function commit() {
    if (settled.current) return;
    settled.current = true;
    const next = draft.replace(/\s+/g, " ").trim();
    if (!next || next === title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await saveTitle(itemId, next);
    setSaving(false);
    if (ok) {
      setEditing(false);
      toast.success("Renamed", { id: "memory-renamed", description: next, duration: 1800 });
    } else {
      settled.current = false;
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void commit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }

  if (editing) {
    return (
      <form onSubmit={onSubmit} className={cn("flex items-center gap-2", className)}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => void commit()}
          onFocus={(e) => e.currentTarget.select()}
          maxLength={300}
          aria-label="Memory title"
          disabled={saving}
          data-testid="item-title-input"
          className={cn(fieldBaseClasses, "h-12 min-w-0 flex-1 rounded-2xl px-4 text-xl font-semibold tracking-tight sm:h-14 sm:text-2xl")}
        />
        <Button type="submit" size="icon" loading={saving} aria-label="Save title" onMouseDown={(e) => e.preventDefault()}>
          <Check />
        </Button>
      </form>
    );
  }

  return (
    <div className={cn("group/title flex items-start gap-1.5", className)}>
      <h1
        onClick={start}
        title="Click to rename"
        data-testid="item-title"
        className="min-w-0 cursor-text text-2xl font-semibold tracking-tight break-words text-zinc-900 sm:text-[2.1rem] sm:leading-tight dark:text-white"
      >
        {title || "Untitled memory"}
      </h1>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Rename"
        onClick={start}
        data-testid="item-rename"
        className="mt-0.5 shrink-0 opacity-70 transition-opacity group-hover/title:opacity-100 sm:mt-1.5"
      >
        <Pencil />
      </Button>
    </div>
  );
}
