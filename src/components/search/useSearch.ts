"use client";
/**
 * Data hooks for the search screens: debounced values, live memory stats, stale-safe search results
 * and autocomplete suggestions. Results from an older query never overwrite a newer one.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { search, suggest } from "@/lib/search";
import type { SearchResponse } from "@/lib/types";
import { ANY_TIME } from "./format";

/** `value`, updated only after it has stopped changing for `ms`. */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, settled, ms]);
  return settled;
}

/** Like useDebouncedValue, but the first defined value passes straight through (no initial delay). */
export function useSettledValue<T>(value: T | undefined, ms: number): T | undefined {
  const settled = useDebouncedValue(value, ms);
  return settled === undefined ? value : settled;
}

export interface MemoryStats {
  /** Number of memories stored on this device. */
  count: number;
  /** Changes whenever a memory is added, edited or removed. */
  version: string;
}

/** Live count of memories plus a cheap change marker (two index-only reads). `undefined` while loading. */
export function useMemoryStats(): MemoryStats | null | undefined {
  return useLiveQuery(async () => {
    try {
      const [count, newest] = await Promise.all([db.items.count(), db.items.orderBy("updatedAt").reverse().limit(1).keys()]);
      return { count, version: `${count}:${String(newest[0] ?? 0)}` };
    } catch {
      return null;
    }
  }, []);
}

export interface SearchRequest {
  /** The question as typed. Empty → nothing runs. */
  query: string;
  limit: number;
  /** Ignore a date phrase in the question ("last month") and search all dates. */
  anyTime?: boolean;
  /** Wait until this is true (e.g. memory stats have loaded). Default true. */
  enabled?: boolean;
  /** Anything else that should re-run the same query when it changes (data version, model state, retries). */
  refreshKey?: string;
}

export interface SearchResult {
  /** Latest response; may belong to an earlier query while a new one runs (see `forQuery`). */
  response: SearchResponse | null;
  error: unknown;
  /** The trimmed query `response`/`error` belong to. */
  forQuery: string;
  /** A search for the current request is running. */
  loading: boolean;
}

interface Settled {
  key: string;
  query: string;
  response: SearchResponse | null;
  error: unknown;
}

const INITIAL: Settled = { key: "", query: "", response: null, error: null };

/** Run local search for a request; re-runs when any part of it changes. */
export function useSearchResults({ query, limit, anyTime = false, enabled = true, refreshKey = "" }: SearchRequest): SearchResult {
  const q = query.trim();
  const key = JSON.stringify([q, limit, anyTime, refreshKey]);
  const [settled, setSettled] = useState<Settled>(INITIAL);

  useEffect(() => {
    if (!q || !enabled) return;
    let cancelled = false;
    search(q, { limit, ...(anyTime ? { dateRange: ANY_TIME } : {}) }).then(
      (response) => {
        if (!cancelled) setSettled({ key, query: q, response, error: null });
      },
      (error: unknown) => {
        if (cancelled) return;
        console.warn("[remembos] search failed", error);
        setSettled({ key, query: q, response: null, error: error ?? new Error("Search failed") });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, q, limit, anyTime, enabled]);

  return {
    response: settled.response,
    error: settled.error,
    forQuery: settled.query,
    loading: Boolean(q) && enabled && settled.key !== key,
  };
}

const NO_SUGGESTIONS: string[] = [];

/** Autocomplete suggestions for what is being typed (names, tags and words found in memories). */
export function useSuggestions(input: string, enabled: boolean, limit = 6): string[] {
  const q = input.trim();
  const debounced = useDebouncedValue(q, 140);
  const [state, setState] = useState<{ q: string; list: string[] }>({ q: "", list: NO_SUGGESTIONS });

  useEffect(() => {
    if (!enabled || debounced.length < 2) return;
    let cancelled = false;
    suggest(debounced, limit).then(
      (list) => {
        if (!cancelled) setState({ q: debounced, list });
      },
      () => {
        if (!cancelled) setState({ q: debounced, list: NO_SUGGESTIONS });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [debounced, enabled, limit]);

  if (!enabled || q.length < 2 || !state.q) return NO_SUGGESTIONS;
  const lower = q.toLowerCase();
  // Keep showing the last list while the next one loads, as long as it still fits what is typed.
  if (!lower.startsWith(state.q.toLowerCase())) return NO_SUGGESTIONS;
  return state.list.filter((s) => s.toLowerCase() !== lower);
}
