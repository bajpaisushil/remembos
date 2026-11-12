"use client";

import { RotateCcw, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Kbd";
import { KindIcon } from "@/components/ui/KindIcon";
import { itemHref } from "@/lib/config";
import { IngestError, ingestText } from "@/lib/ingest";
import { deriveTitle } from "@/lib/nlp/chunk";
import { createStore, useStore } from "@/lib/store";
import { quickAdd } from "@/lib/ui-state";
import { cn, truncate } from "@/lib/utils";
import { addTags, TagInput } from "./TagInput";

type Mode = "note" | "text";

interface Draft {
  title: string;
  text: string;
  tags: string[];
}

interface Session {
  id: number;
  mode: Mode;
  initialText?: string;
}

/** Unsaved work per mode, kept in memory so closing by accident (Esc, backdrop) never loses a note. */
const drafts = createStore<Partial<Record<Mode, Draft>>>({});

function saveDraft(mode: Mode, draft: Draft): void {
  drafts.set((all) => ({ ...all, [mode]: draft }));
}

function clearDraft(mode: Mode): void {
  drafts.set((all) => {
    const next = { ...all };
    delete next[mode];
    return next;
  });
}

function isEmptyDraft(d: Draft | undefined): boolean {
  return !d || (!d.text.trim() && !d.title.trim() && d.tags.length === 0);
}

const COPY: Record<Mode, { title: string; placeholder: string; textLabel: string; empty: string; titleExample: string; saved: string }> = {
  note: {
    title: "New note",
    placeholder: "What do you want to remember? A decision, an idea, a name, a number…",
    textLabel: "Note",
    empty: "Write something first — even one line is enough.",
    titleExample: "e.g. Decision about the Atlas launch",
    saved: "Note saved",
  },
  text: {
    title: "Save copied text",
    placeholder: "Paste anything you copied — a chat, an email, an address, a recipe…",
    textLabel: "Text",
    empty: "Paste or type some text first.",
    titleExample: "e.g. Landlord's email about the deposit",
    saved: "Text saved",
  },
};

function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Note composer (title + text + tags, ⌘/Ctrl+Enter saves), opened through the `quickAdd` store: "Add note"
 * in the header menu and mobile add sheet, the "n" shortcut, "or add a note" on home. Notes are the
 * secondary way in — uploads and Paste save instantly without this dialog. `mode: "text"` (a text snippet to
 * review before saving) is still honoured for callers that ask for it. Mounted once by the shell; no props.
 */
export function QuickAddDialog() {
  const request = useStore(quickAdd);
  const [session, setSession] = useState<Session | null>(null);
  // Starts as null so a composer that loads after "open" was requested (it is loaded on demand) still opens.
  const [prevRequest, setPrevRequest] = useState<typeof request>(null);

  // Each open starts a fresh composer (keyed by session id); closing keeps it mounted for the exit animation.
  if (request !== prevRequest) {
    setPrevRequest(request);
    if (request) setSession((s) => ({ id: (s?.id ?? 0) + 1, mode: request.mode, initialText: request.initialText }));
  }

  if (!session) return null;
  return <Composer key={session.id} session={session} open={request !== null} />;
}

function Composer({ session, open }: { session: Session; open: boolean }) {
  const { mode } = session;
  const copy = COPY[mode];
  const router = useRouter();
  const formId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  /** Set once saved: late events (e.g. the tag field's blur as the dialog closes) must not recreate a draft. */
  const savedRef = useRef(false);

  const [initial] = useState(() => {
    if (session.initialText?.trim()) {
      return { draft: { title: "", text: session.initialText, tags: [] as string[] }, restored: false };
    }
    const saved = drafts.get()[mode];
    return isEmptyDraft(saved) ? { draft: { title: "", text: "", tags: [] as string[] }, restored: false } : { draft: saved as Draft, restored: true };
  });
  const [title, setTitle] = useState(initial.draft.title);
  const [text, setText] = useState(initial.draft.text);
  const [tags, setTags] = useState<string[]>(initial.draft.tags);
  const [pendingTag, setPendingTag] = useState("");
  const [restored, setRestored] = useState(initial.restored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh paste supersedes an older unsaved one; it only becomes a draft once it is edited.
  useEffect(() => {
    if (session.initialText?.trim()) clearDraft(mode);
  }, [mode, session.initialText]);

  // Restored draft: put the caret at the end so typing continues where it stopped.
  useEffect(() => {
    if (!initial.restored) return;
    const el = textRef.current;
    if (el && document.activeElement === el) el.setSelectionRange(el.value.length, el.value.length);
  }, [initial.restored]);

  function update(patch: Partial<Draft>) {
    if (savedRef.current) return;
    const next: Draft = { title, text, tags, ...patch };
    if (patch.title !== undefined) setTitle(patch.title);
    if (patch.text !== undefined) setText(patch.text);
    if (patch.tags !== undefined) setTags(patch.tags);
    if (error) setError(null);
    if (isEmptyDraft(next)) clearDraft(mode);
    else saveDraft(mode, next);
  }

  function startOver() {
    setTitle("");
    setText("");
    setTags([]);
    setPendingTag("");
    setRestored(false);
    setError(null);
    clearDraft(mode);
    textRef.current?.focus();
  }

  function close() {
    if (!saving) quickAdd.set(null);
  }

  async function save() {
    if (saving) return;
    const body = text.trim();
    if (!body) {
      setError(copy.empty);
      textRef.current?.focus();
      return;
    }
    const allTags = pendingTag.trim() ? addTags(tags, pendingTag) : tags;
    const chosenTitle = title.trim();
    setSaving(true);
    setError(null);
    try {
      const id = await ingestText(body, { title: chosenTitle || undefined, kind: mode, tags: allTags });
      savedRef.current = true;
      setPendingTag("");
      clearDraft(mode);
      quickAdd.set(null);
      const shown = chosenTitle || deriveTitle(body, mode === "note" ? "Untitled note" : "Pasted text");
      toast.success(copy.saved, {
        description: `“${truncate(shown, 60)}” is on this device and searchable now.`,
        action: { label: "Open", onClick: () => router.push(itemHref(id)) },
      });
    } catch (err) {
      setError(
        err instanceof IngestError
          ? err.message
          : "Couldn't save this right now. Your text is still here — try again in a moment.",
      );
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void save();
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void save();
    }
  }

  const words = countWords(text);
  const autoTitle = text.trim() ? deriveTitle(text.slice(0, 2000), "") : "";
  const focusTitleFirst = Boolean(session.initialText?.trim());
  const ids = { title: `${formId}-title`, text: `${formId}-text`, tags: `${formId}-tags`, tagsHint: `${formId}-tags-hint` };

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!saving}
      title={copy.title}
      description={
        <span className="flex items-start gap-1.5">
          <ShieldCheck aria-hidden className="mt-[0.2em] size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          Saved on this device only. Find it later by any word in it.
        </span>
      }
      icon={<KindIcon kind={mode} size="lg" />}
      size="lg"
      data-testid="quick-add"
      footer={
        <>
          <span className="mr-auto hidden items-center gap-1.5 text-xs text-muted sm:inline-flex">
            <Kbd keys={["mod", "enter"]} /> to save · <Kbd>Esc</Kbd> to close
          </span>
          <Button variant="secondary" onClick={close} disabled={saving} data-testid="quick-add-cancel">
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving} data-testid="quick-add-save">
            {saving ? "Saving…" : mode === "note" ? "Save note" : "Save text"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} onKeyDown={onKeyDown} className="flex flex-col gap-4" noValidate>
        {restored ? (
          <div className="-mt-1 flex items-center justify-between gap-3 rounded-xl bg-brand-500/[0.07] px-3 py-2 text-[13px] text-brand-800 dark:bg-brand-400/10 dark:text-brand-200">
            <span>Your unsaved draft is back.</span>
            <Button variant="ghost" size="sm" leftIcon={<RotateCcw />} onClick={startOver} data-testid="quick-add-discard">
              Start over
            </Button>
          </div>
        ) : null}

        <Field label="Title" htmlFor={ids.title} optional>
          <Input
            id={ids.title}
            value={title}
            onChange={(e) => update({ title: e.target.value })}
            onKeyDown={(e) => {
              // Enter in the title moves on to the text instead of saving half a note.
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                textRef.current?.focus();
              }
            }}
            placeholder={autoTitle ? `Leave empty to use “${truncate(autoTitle, 48)}”` : copy.titleExample}
            maxLength={200}
            autoComplete="off"
            enterKeyHint="next"
            data-autofocus={focusTitleFirst || undefined}
            data-testid="quick-add-title"
          />
        </Field>

        <Field
          label={copy.textLabel}
          htmlFor={ids.text}
          error={error ?? undefined}
          hint={
            <span className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
              <span>Phone numbers, emails, links, dates and amounts are picked out automatically.</span>
              <span className="tabular-nums" aria-live="off">
                {words.toLocaleString()} {words === 1 ? "word" : "words"}
              </span>
            </span>
          }
        >
          <textarea
            ref={textRef}
            id={ids.text}
            value={text}
            onChange={(e) => update({ text: e.target.value })}
            placeholder={copy.placeholder}
            rows={8}
            aria-invalid={error ? true : undefined}
            data-autofocus={!focusTitleFirst || undefined}
            data-testid="quick-add-text"
            className={cn(
              "block w-full min-w-0 resize-y rounded-xl border bg-white px-3.5 py-3 text-[15px] leading-relaxed text-zinc-900 placeholder:text-zinc-400",
              "field-sizing-content min-h-36 max-h-[50dvh] shadow-[0_1px_2px_rgb(20_20_43/0.04)] sm:min-h-56",
              "transition-[border-color,box-shadow] duration-150 ease-out focus:outline-none focus:ring-4 focus-visible:outline-none",
              "dark:bg-white/[0.05] dark:text-zinc-100 dark:placeholder:text-zinc-500",
              error
                ? "border-rose-400 focus:border-rose-500 focus:ring-rose-500/15 dark:border-rose-400/60"
                : "border-zinc-200/90 hover:border-zinc-300 focus:border-brand-400 focus:ring-brand-500/15 dark:border-white/10 dark:hover:border-white/20 dark:focus:border-brand-400/70 dark:focus:ring-brand-400/20",
            )}
          />
        </Field>

        <Field label="Tags" htmlFor={ids.tags} optional hint={<span id={ids.tagsHint}>Press Enter or comma to add a tag — e.g. work, travel, receipts.</span>}>
          <TagInput
            id={ids.tags}
            tags={tags}
            onTagsChange={(next) => update({ tags: next })}
            pending={pendingTag}
            onPendingChange={setPendingTag}
            aria-describedby={ids.tagsHint}
            data-testid="quick-add-tags"
          />
        </Field>
      </form>
    </Dialog>
  );
}
