"use client";
/**
 * Recent searches — a short list kept in this browser's localStorage under
 * "remembos:recent-searches" (never sent anywhere). Shared by the search page and the command
 * palette, kept in sync across tabs, and safe when storage is blocked or full (the list then lives
 * in memory for this visit only).
 */
import { useSyncExternalStore } from "react";
import { STORAGE_NAMES } from "@/lib/config";
import { createStore } from "@/lib/store";
import { parseRecent, pushRecent } from "./format";

export const RECENT_SEARCHES_KEY = `${STORAGE_NAMES.keyPrefix}recent-searches`;

const EMPTY: string[] = [];
const recentStore = createStore<string[]>(EMPTY);
let loaded = false;

function read(): string[] {
  try {
    return parseRecent(window.localStorage.getItem(RECENT_SEARCHES_KEY));
  } catch {
    return EMPTY;
  }
}

function write(list: string[]): void {
  recentStore.set(list);
  try {
    if (list.length) window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
    else window.localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    /* storage blocked or full — the list still works for this visit */
  }
}

function ensureLoaded(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  recentStore.set(read());
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key === RECENT_SEARCHES_KEY) recentStore.set(read());
  });
}

function subscribe(listener: () => void): () => void {
  ensureLoaded();
  return recentStore.subscribe(listener);
}

const getServerSnapshot = () => EMPTY;

/** Recent searches, newest first (empty during prerender). */
export function useRecentSearches(): string[] {
  return useSyncExternalStore(subscribe, recentStore.get, getServerSnapshot);
}

export function addRecentSearch(query: string): void {
  if (typeof window === "undefined" || !query.trim()) return;
  ensureLoaded();
  const next = pushRecent(recentStore.get(), query);
  const prev = recentStore.get();
  if (next.length === prev.length && next.every((q, i) => q === prev[i])) return;
  write(next);
}

export function removeRecentSearch(query: string): void {
  if (typeof window === "undefined") return;
  ensureLoaded();
  const lower = query.toLowerCase();
  write(recentStore.get().filter((q) => q.toLowerCase() !== lower));
}

export function clearRecentSearches(): void {
  if (typeof window === "undefined") return;
  ensureLoaded();
  write(EMPTY);
}
