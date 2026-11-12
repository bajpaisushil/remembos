"use client";
/**
 * Command palette — ⌘K / Ctrl+K anywhere, or "/" when not typing (on the search page "/" focuses
 * the page's own search box instead). Also opens whenever `paletteOpen` is set.
 *
 * Live top results from local search (with instant smart answers you can copy), "See all results",
 * quick actions (upload files, paste from the clipboard, record voice, new note, theme, sample memories)
 * and navigation. Full
 * keyboard control: ↑/↓ to move, ↵ to run, Esc to close (focus returns where it was).
 * Centered on larger screens, a bottom sheet on phones. Mounted once by the app shell; no props.
 */
import {
  ArrowRight,
  CircleHelp,
  ClipboardPaste,
  Clock,
  CornerDownLeft,
  FolderTree,
  HardDrive,
  House,
  LibraryBig,
  Mic,
  Moon,
  PencilLine,
  Search,
  ShieldCheck,
  StickyNote,
  Sun,
  Upload,
  WandSparkles,
  Waypoints,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { resolveTheme } from "@/components/shell/theme";
import { Dialog, ENTITY_ICONS, Kbd, KindIcon, Skeleton, Spinner } from "@/components/ui";
import { openNote, openRecorder, openUploadPicker, pasteNow } from "@/lib/add-actions";
import { ENTITY_META, ROUTES, searchHref } from "@/lib/config";
import { parseQuery } from "@/lib/nlp/query";
import { updateSettings, useSettings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import type { SearchHit, SmartAnswer } from "@/lib/types";
import { paletteOpen, quickAdd } from "@/lib/ui-state";
import { cn, copyToClipboard, timeAgo, truncate } from "@/lib/utils";
import { ANSWER_LABEL, focusSnippet, formatAnswerValue, memoryHref, termRanges } from "./format";
import { Highlight } from "./Highlight";
import { addRecentSearch, useRecentSearches } from "./recent";
import { useDebouncedValue, useMemoryStats, useSearchResults } from "./useSearch";

const RESULT_LIMIT = 6;
const ANSWER_LIMIT = 2;
const RECENT_LIMIT = 4;
const DEBOUNCE_MS = 120;


/** The global command palette. */
export function CommandPalette() {
  const open = useStore(paletteOpen);
  return (
    <Dialog
      open={open}
      onClose={() => paletteOpen.set(false)}
      align="top"
      size="lg"
      padded={false}
      hideClose
      aria-label="Search memories and actions"
      data-testid="command-palette"
      className="max-sm:min-h-[min(34rem,70dvh)]"
    >
      <PaletteBody />
    </Dialog>
  );
}

// ---------- Entries ----------

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  /** Extra words that should find this action. */
  keywords: string;
  shortcut?: string[];
  run: () => void;
}

type Entry =
  | { id: string; type: "answer"; answer: SmartAnswer }
  | { id: string; type: "result"; hit: SearchHit }
  | { id: string; type: "see-all" }
  | { id: string; type: "recent"; query: string }
  | { id: string; type: "action"; action: PaletteAction };

interface Group {
  id: string;
  label: string;
  entries: Entry[];
  /** Shown instead of entries (loading rows, "no matches"). */
  placeholder?: ReactNode;
}

/**
 * How well a typed command matches an action: 3 = clearly meant (label starts with it, every word
 * matches the label, or it is exactly one of the action's keywords) → shown above memories;
 * 2 = a word starts one of its words; 1 = all words found somewhere; 0 = no match.
 */
function actionScore(a: PaletteAction, q: string): number {
  const query = q.toLowerCase().replace(/\s+/g, " ").trim();
  if (!query) return 0;
  const label = a.label.toLowerCase();
  if (label.startsWith(query)) return query.length >= 2 ? 3 : 2;
  const labelWords = label.split(/[\s/…]+/).filter(Boolean);
  const keywordWords = a.keywords.toLowerCase().split(/\s+/).filter(Boolean);
  const parts = query.split(" ");
  if (parts.every((p) => labelWords.some((w) => w.startsWith(p)))) return parts.length > 1 || query.length >= 3 ? 3 : 2;
  if (parts.length === 1 && keywordWords.includes(query)) return 3;
  const words = [...labelWords, ...keywordWords];
  if (words.some((w) => w.startsWith(query))) return 2;
  if (parts.length > 1 && parts.every((p) => words.some((w) => w.startsWith(p)))) return 1;
  return 0;
}

function closePalette() {
  paletteOpen.set(false);
}

// ---------- Body ----------

function PaletteBody() {
  const router = useRouter();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const settings = useSettings();
  const recent = useRecentSearches();
  const stats = useMemoryStats();
  const hasMemories = stats === null || (stats !== undefined && stats.count > 0);

  const [input, setInput] = useState("");
  const typed = input.trim();
  const debounced = useDebouncedValue(typed, DEBOUNCE_MS);
  const query = typed ? debounced : "";

  const { response, forQuery, loading } = useSearchResults({ query, limit: RESULT_LIMIT, enabled: hasMemories });
  const busy = Boolean(typed) && (loading || typed !== query);
  const showSpinner = useDebouncedValue(busy, 160) && busy;
  const results = query && response && (forQuery === query || loading) ? response : null;
  const words = useMemo(() => {
    if (!query) return [];
    try {
      return parseQuery(query).keywords.split(/\s+/).filter(Boolean);
    } catch {
      return query.toLowerCase().split(/\s+/);
    }
  }, [query]);

  const dark = resolveTheme(settings.theme) === "dark";

  const actions = useMemo(() => {
    const go = (href: string) => () => router.push(href);
    const doActions: PaletteAction[] = [
      {
        id: "upload",
        label: "Upload files",
        hint: "Screenshots, PDFs, videos, audio, text",
        icon: Upload,
        keywords: "add import file files image photo screenshot pdf video movie audio voice recording document",
        run: () => openUploadPicker(),
      },
      {
        id: "paste",
        label: "Paste from clipboard",
        hint: "Saves what you copied, right away",
        icon: ClipboardPaste,
        keywords: "clipboard copy copied paste add save image text link",
        shortcut: ["mod", "v"],
        run: () => {
          void pasteNow().catch(() => {
            /* pasting explains clipboard problems in its own toast */
          });
        },
      },
      {
        id: "record",
        label: "Record voice",
        hint: "Speak a memo — transcribed on this device",
        icon: Mic,
        keywords: "record voice audio memo microphone mic dictate speak",
        run: openRecorder,
      },
      {
        id: "new-note",
        label: "New note",
        hint: "Jot something down to find later",
        icon: StickyNote,
        keywords: "write jot add create memo",
        shortcut: ["n"],
        run: openNote,
      },
      {
        id: "type-text",
        label: "Type or paste text…",
        hint: "Save text you write or paste yourself",
        icon: PencilLine,
        keywords: "text paste write add save quick",
        run: () => quickAdd.set({ mode: "text" }),
      },
      {
        id: "toggle-theme",
        label: dark ? "Switch to light mode" : "Switch to dark mode",
        hint: "Change how Remembos looks",
        icon: dark ? Sun : Moon,
        keywords: "theme dark light mode appearance colour color night",
        run: () => updateSettings({ theme: dark ? "light" : "dark" }),
      },
      {
        id: "samples",
        label: "Try sample memories",
        hint: "Add 10 example memories to explore",
        icon: WandSparkles,
        keywords: "sample demo example try test",
        run: () => {
          void import("@/lib/storage/sample")
            .then(({ loadSampleData }) => loadSampleData())
            .catch(() => {
              /* loadSampleData already explained the problem in a toast */
            });
        },
      },
    ];
    const goActions: PaletteAction[] = [
      { id: "go-home", label: "Home", hint: "Upload & drop zone", icon: House, keywords: "start drop upload", run: go(ROUTES.home) },
      { id: "go-search", label: "Search page", hint: "Full results with filters", icon: Search, keywords: "find ask", run: go(ROUTES.search) },
      { id: "go-library", label: "Library", hint: "Browse every memory", icon: LibraryBig, keywords: "browse all memories list", run: go(ROUTES.library) },
      { id: "go-graph", label: "Graph", hint: "See how memories connect", icon: Waypoints, keywords: "knowledge map connections network", run: go(ROUTES.graph) },
      { id: "go-data", label: "Your data", hint: "Storage, backups and AI models", icon: HardDrive, keywords: "storage backup export import settings delete clear models", run: go(ROUTES.data) },
      {
        id: "go-storage",
        label: "Where your data lives",
        hint: "Browser storage, explained",
        icon: FolderTree,
        keywords: "storage indexeddb location disk folder privacy",
        run: go(ROUTES.storage),
      },
      { id: "go-help", label: "Help", hint: "How Remembos works", icon: CircleHelp, keywords: "faq guide support how", run: go(ROUTES.help) },
    ];
    // With nothing stored yet, getting started comes first.
    if (stats?.count === 0) {
      const order = ["upload", "paste", "record", "samples", "new-note", "type-text", "toggle-theme"];
      doActions.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }
    return { doActions, goActions };
  }, [router, dark, stats?.count]);

  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [];
    if (!typed) {
      if (recent.length) {
        out.push({
          id: "recent",
          label: "Recent searches",
          entries: recent.slice(0, RECENT_LIMIT).map((r) => ({ id: `recent-${r}`, type: "recent", query: r })),
        });
      }
      out.push({ id: "do", label: "Actions", entries: actions.doActions.map((a) => ({ id: a.id, type: "action", action: a })) });
      out.push({ id: "go", label: "Go to", entries: actions.goActions.map((a) => ({ id: a.id, type: "action", action: a })) });
      return out;
    }

    const scored = [...actions.doActions, ...actions.goActions]
      .map((a) => ({ a, score: actionScore(a, typed) }))
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score);
    const strong = scored.filter((x) => x.score >= 3).slice(0, 2);
    const rest = scored.filter((x) => !strong.includes(x));
    if (strong.length) {
      out.push({ id: "suggested", label: "Suggested", entries: strong.map(({ a }) => ({ id: a.id, type: "action", action: a })) });
    }

    if (hasMemories) {
      if (results?.answers.length) {
        out.push({
          id: "answers",
          label: results.answers.length === 1 ? "Answer" : "Answers",
          entries: results.answers.slice(0, ANSWER_LIMIT).map((answer) => ({
            id: `answer-${answer.type}-${answer.value}-${answer.itemId}`,
            type: "answer",
            answer,
          })),
        });
      }
      const entries: Entry[] = (results?.hits ?? []).map((hit) => ({ id: `result-${hit.item.id}`, type: "result", hit }));
      entries.push({ id: "see-all", type: "see-all" });
      out.push({
        id: "memories",
        label: "Memories",
        entries,
        placeholder: !results ? <LoadingRows /> : results.hits.length === 0 ? <NoMatches query={typed} /> : undefined,
      });
    } else if (stats?.count === 0) {
      out.push({ id: "memories", label: "Memories", entries: [], placeholder: <NothingStored /> });
    }

    if (rest.length) out.push({ id: "actions", label: "Actions", entries: rest.map(({ a }) => ({ id: a.id, type: "action", action: a })) });
    return out;
  }, [typed, recent, actions, hasMemories, results, stats?.count]);

  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);

  // Typing starts again from the top.
  const [active, setActive] = useState(0);
  const [activeFor, setActiveFor] = useState(typed);
  if (activeFor !== typed) {
    setActiveFor(typed);
    setActive(0);
  }
  const activeIndex = flat.length ? Math.min(active, flat.length - 1) : -1;
  const activeEntry = activeIndex >= 0 ? flat[activeIndex] : undefined;
  const optionId = (entry: Entry) => `${baseId}-opt-${entry.id}`;
  const activeId = activeEntry ? optionId(activeEntry) : undefined;

  useEffect(() => {
    if (!activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function execute(entry: Entry) {
    switch (entry.type) {
      case "result":
        addRecentSearch(query || typed);
        closePalette();
        router.push(memoryHref(entry.hit.item.id, query || typed));
        return;
      case "see-all":
        addRecentSearch(typed);
        closePalette();
        router.push(searchHref(typed));
        return;
      case "answer": {
        const { value, type } = entry.answer;
        addRecentSearch(query || typed);
        void copyToClipboard(value).then((ok) => {
          if (ok) toast.success(`${ANSWER_LABEL[type]} copied`, { id: "copied", description: truncate(value, 80), duration: 2000 });
          else toast.error("Couldn't copy", { id: "copied", description: "Your browser blocked clipboard access. Open the memory and copy it from there." });
        });
        closePalette();
        return;
      }
      case "recent":
        setInput(entry.query);
        inputRef.current?.focus();
        return;
      case "action":
        closePalette();
        entry.action.run();
        return;
    }
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!flat.length) return;
      e.preventDefault();
      setActive((activeIndex + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
      return;
    }
    if (e.key === "PageDown" || e.key === "PageUp") {
      if (!flat.length) return;
      e.preventDefault();
      setActive(Math.max(0, Math.min(flat.length - 1, activeIndex + (e.key === "PageDown" ? 5 : -5))));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeEntry) execute(activeEntry);
      else if (typed && hasMemories) execute({ id: "see-all", type: "see-all" });
    }
  }

  return (
    <div className="relative flex flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 aurora opacity-70 dark:opacity-80"
      />

      {/* Input row */}
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-zinc-200/70 bg-elevated/90 px-4 backdrop-blur-md sm:h-16 sm:px-5 dark:border-white/[0.08]">
        {showSpinner ? (
          <Spinner size="md" className="text-brand-500 dark:text-brand-300" />
        ) : (
          <Search aria-hidden className="size-5 shrink-0 text-brand-500 dark:text-brand-300" />
        )}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          type="text"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Search memories or run a command"
          placeholder={stats?.count === 0 ? "Type a command…" : "Search memories or type a command…"}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={500}
          data-autofocus
          data-testid="palette-input"
          className="h-full min-w-0 flex-1 bg-transparent text-base text-zinc-900 outline-none placeholder:text-zinc-400 sm:text-lg dark:text-white dark:placeholder:text-zinc-500"
        />
        {input ? (
          <button
            type="button"
            onClick={() => {
              setInput("");
              inputRef.current?.focus();
            }}
            aria-label="Clear"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-900/5 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={closePalette}
          className="shrink-0 rounded-lg px-1.5 py-1 text-sm font-medium text-brand-700 transition-colors hover:bg-zinc-900/5 sm:hidden dark:text-brand-300 dark:hover:bg-white/10"
        >
          Cancel
        </button>
        <button type="button" onClick={closePalette} aria-label="Close" className="hidden shrink-0 rounded-md sm:inline-flex">
          <Kbd>esc</Kbd>
        </button>
      </div>

      {/* Results & actions */}
      <div id={listId} role="listbox" aria-label="Results and actions" className="relative p-2 sm:p-2.5" data-testid="palette-list">
        {groups.map((group) => {
          const headingId = `${baseId}-group-${group.id}`;
          return (
            <div key={group.id} role="presentation" className="pb-1.5 last:pb-0">
              <div id={headingId} aria-hidden className="px-3 pt-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.12em] text-zinc-400 uppercase dark:text-zinc-500">
                {group.label}
              </div>
              {group.placeholder ? <div role="presentation">{group.placeholder}</div> : null}
              {group.entries.length ? (
                <div role="group" aria-labelledby={headingId}>
                  {group.entries.map((entry) => {
                    const index = flat.indexOf(entry);
                    const isActive = index === activeIndex;
                    return (
                      <div
                        key={entry.id}
                        id={optionId(entry)}
                        role="option"
                        aria-selected={isActive}
                        onPointerMove={() => {
                          if (!isActive) setActive(index);
                        }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => execute(entry)}
                        data-testid={`palette-${entry.type}`}
                        data-action={entry.type === "action" ? entry.action.id : undefined}
                        className={cn(
                          "relative flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-100 select-none",
                          isActive
                            ? "bg-brand-500/[0.09] text-zinc-950 ring-1 ring-brand-500/15 ring-inset dark:bg-brand-400/[0.14] dark:text-white dark:ring-brand-400/20"
                            : "text-zinc-700 dark:text-zinc-300",
                        )}
                      >
                        <EntryContent entry={entry} words={words} typed={typed} active={isActive} />
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 z-10 hidden items-center justify-between gap-4 border-t border-zinc-200/70 bg-elevated/90 px-5 py-2.5 text-xs text-muted backdrop-blur-md sm:flex dark:border-white/[0.08]">
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <Kbd keys={["up"]} />
            <Kbd keys={["down"]} />
            move
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd keys={["enter"]} />
            open
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>esc</Kbd>
            close
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck aria-hidden className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          Searches stay on this device
        </span>
      </div>
    </div>
  );
}

// ---------- Rows ----------

function EntryContent({ entry, words, typed, active }: { entry: Entry; words: string[]; typed: string; active: boolean }) {
  const enter = (
    <CornerDownLeft
      aria-hidden
      className={cn("size-3.5 shrink-0 text-zinc-400 transition-opacity dark:text-zinc-500", active ? "opacity-100" : "opacity-0")}
    />
  );

  switch (entry.type) {
    case "answer": {
      const a = entry.answer;
      const Icon = ENTITY_ICONS[a.type];
      return (
        <>
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white shadow-soft ring-1 ring-zinc-200/80 dark:bg-white/[0.08] dark:ring-white/10">
            <Icon aria-hidden className={cn("size-3.5", ENTITY_META[a.type].color)} strokeWidth={2.3} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-zinc-900 tabular-nums dark:text-white">{formatAnswerValue(a.type, a.value)}</span>
            <span className="block truncate text-xs text-muted">
              {ANSWER_LABEL[a.type]} · from {a.itemTitle || "Untitled memory"}
            </span>
          </span>
          <span className={cn("shrink-0 text-xs font-medium text-brand-700 dark:text-brand-300", active ? "opacity-100" : "opacity-0")}>Copy</span>
          {enter}
        </>
      );
    }
    case "result": {
      const { item, snippets } = entry.hit;
      const snippet = snippets[0];
      const preview = snippet ? focusSnippet(snippet.text, snippet.highlights) : null;
      return (
        <>
          <KindIcon kind={item.kind} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">
              <Highlight text={item.title || "Untitled memory"} ranges={termRanges(item.title || "", words)} />
            </span>
            {preview ? (
              <span className="block truncate text-xs text-muted">
                <Highlight text={preview.text.replace(/\s+/g, " ")} ranges={preview.highlights} />
              </span>
            ) : null}
          </span>
          <span className="hidden shrink-0 text-[11px] text-muted tabular-nums min-[420px]:inline">{timeAgo(item.sourceDate ?? item.createdAt)}</span>
          {enter}
        </>
      );
    }
    case "see-all":
      return (
        <>
          <span className="grid size-7 shrink-0 place-items-center rounded-lg brand-gradient text-white shadow-glow">
            <Search aria-hidden className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate">
            See all results for <span className="font-semibold text-zinc-900 dark:text-white">“{typed}”</span>
          </span>
          <ArrowRight aria-hidden className={cn("size-4 shrink-0 text-brand-600 transition-opacity dark:text-brand-300", active ? "opacity-100" : "opacity-40")} />
        </>
      );
    case "recent":
      return (
        <>
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-white/[0.07] dark:text-zinc-400">
            <Clock aria-hidden className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate">{entry.query}</span>
          {enter}
        </>
      );
    case "action": {
      const { icon: Icon, label, hint, shortcut } = entry.action;
      return (
        <>
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-lg transition-colors",
              active ? "bg-brand-500/15 text-brand-700 dark:bg-brand-400/20 dark:text-brand-200" : "bg-zinc-100 text-zinc-500 dark:bg-white/[0.07] dark:text-zinc-400",
            )}
          >
            <Icon aria-hidden className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
            {hint ? <span className="hidden text-muted sm:inline"> — {hint}</span> : null}
          </span>
          {shortcut ? <Kbd keys={shortcut} className="hidden shrink-0 sm:inline-flex" /> : null}
          {enter}
        </>
      );
    }
  }
}

function LoadingRows() {
  return (
    <div aria-hidden className="space-y-1 px-1">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="size-7 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className={cn("h-3 rounded-full", i === 1 ? "w-1/2" : "w-2/3")} />
            <Skeleton className="h-2.5 w-5/6 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function NoMatches({ query }: { query: string }) {
  return (
    <p className="px-3 pb-1 text-sm text-muted" role="status">
      No memories match <span className="font-medium text-zinc-700 dark:text-zinc-200">“{truncate(query, 60)}”</span>. Try fewer words.
    </p>
  );
}

function NothingStored() {
  return (
    <p className="px-3 pb-1 text-sm text-muted" role="status">
      Nothing stored yet — upload files, paste something or try the sample memories below.
    </p>
  );
}
