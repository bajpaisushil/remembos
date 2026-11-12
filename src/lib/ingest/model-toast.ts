// "Downloading the … (one time)" toast for local models, with a live percentage.
// Shown only when loading actually takes a while, so cached models load silently.
import { toast } from "sonner";
import { formatBytes } from "../utils";

export interface ModelToastOptions {
  /** Sonner toast id (dedupes/updates), e.g. "model-ocr". */
  id: string;
  /** e.g. "the text reader". */
  label: string;
  approxBytes: number;
  readyTitle: string;
  readyDescription: string;
  /** Wait this long before showing anything (a cached model is usually ready by then). */
  delayMs?: number;
}

export interface ModelToast {
  progress(fraction: number | undefined, loaded?: number, total?: number): void;
  ready(): void;
  fail(): void;
}

export function modelDownloadToast(opts: ModelToastOptions): ModelToast {
  let shown = false;
  let finished = false;
  let fraction: number | undefined;
  let loaded: number | undefined;
  let total: number | undefined;
  let lastPaint = 0;
  const mb = Math.max(1, Math.round(opts.approxBytes / 1_000_000));
  const title = `Downloading ${opts.label} (${mb} MB, one time)…`;

  const describe = () => {
    if (fraction === undefined) return "Starting… It stays on this device for next time.";
    const pct = Math.min(99, Math.round(fraction * 100));
    const bytes = loaded && total ? ` · ${formatBytes(loaded)} of ${formatBytes(total)}` : "";
    return `${pct}%${bytes} — it stays on this device for next time.`;
  };

  const paint = () => {
    lastPaint = Date.now();
    toast.loading(title, { id: opts.id, description: describe(), duration: Infinity });
  };

  const timer = setTimeout(() => {
    // Files already (almost) all read means they came from the cache — no download to announce.
    if (finished || (fraction ?? 0) >= 0.9) return;
    shown = true;
    paint();
  }, opts.delayMs ?? 900);

  return {
    progress(f, l, t) {
      if (finished) return;
      if (typeof f === "number" && Number.isFinite(f)) fraction = Math.max(fraction ?? 0, Math.min(1, f));
      if (l !== undefined) loaded = l;
      if (t !== undefined) total = t;
      if (shown && Date.now() - lastPaint > 250) paint();
    },
    ready() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (shown) toast.success(opts.readyTitle, { id: opts.id, description: opts.readyDescription, duration: 4000 });
    },
    fail() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      toast.error(`Couldn't download ${opts.label}`, {
        id: opts.id,
        description: offline
          ? "You're offline. Reconnect once to download it — keyword search still works for everything else."
          : "Check your connection or any content blocker, then retry. Keyword search still works for everything else.",
        duration: 10_000,
      });
    },
  };
}
