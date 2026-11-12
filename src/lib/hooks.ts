"use client";

import { liveQuery } from "dexie";
import { useEffect, useState, useSyncExternalStore } from "react";
import { db } from "./db";

/** Object URL for an item's stored thumbnail (revoked automatically). */
export function useThumbnailUrl(itemId: string | undefined, hasThumb: 0 | 1 | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!itemId || !hasThumb) return;
    let revoked = false;
    let objectUrl: string | null = null;
    db.thumbs
      .get(itemId)
      .then((t) => {
        if (revoked || !t) return;
        objectUrl = URL.createObjectURL(t.blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [itemId, hasThumb]);
  return url;
}

/**
 * Object URL for an item's original file (revoked automatically). Follows the stored row live: right after
 * a big file is added its original is still being written in the background, and the URL appears as soon
 * as it lands.
 */
export function useFileUrl(itemId: string | undefined, hasFile: 0 | 1 | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!itemId || !hasFile) return;
    let objectUrl: string | null = null;
    let current: Blob | null = null;
    const subscription = liveQuery(() => db.files.get(itemId)).subscribe({
      next: (f) => {
        const blob = f?.blob ?? null;
        if (blob === current || (blob && current && blob.size === current.size && blob.type === current.type)) return;
        current = blob;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = blob ? URL.createObjectURL(blob) : null;
        setUrl(objectUrl);
      },
      error: () => {},
    });
    return () => {
      subscription.unsubscribe();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [itemId, hasFile]);
  return url;
}

/** true after the first client render — use to avoid hydration mismatches for browser-only UI. */
export function useMounted(): boolean {
  // Server render and hydration see `false`; every client render after that sees `true`.
  return useSyncExternalStore(noopSubscribe, clientSnapshot, serverSnapshot);
}

const noopSubscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
