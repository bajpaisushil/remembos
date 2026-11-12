import { memo } from "react";
import { cn } from "@/lib/utils";
import { hashString } from "./memory-data";

export interface WaveformProps {
  /** Seed so each recording gets its own (stable) shape. */
  seed: string;
  bars?: number;
  className?: string;
  /** Bar classes (color). */
  barClassName?: string;
}

/** Decorative waveform (not real audio data): soft rounded bars with a natural speech-like envelope. */
export const Waveform = memo(function Waveform({ seed, bars = 40, className, barClassName }: WaveformProps) {
  let h = hashString(seed) || 1;
  const rand = () => {
    // xorshift32 — deterministic per seed.
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1000) / 1000;
  };
  const heights: number[] = [];
  for (let i = 0; i < bars; i++) {
    const t = i / (bars - 1);
    const envelope = 0.35 + 0.65 * Math.sin(Math.PI * t) ** 0.6;
    const phrase = 0.55 + 0.45 * Math.abs(Math.sin(t * 9.5 + (hashString(seed) % 7)));
    heights.push(Math.max(0.12, Math.min(1, envelope * phrase * (0.55 + 0.45 * rand()))));
  }
  return (
    <div aria-hidden className={cn("flex h-full w-full items-center gap-[3px]", className)}>
      {heights.map((v, i) => (
        <span
          key={i}
          className={cn("min-w-0 flex-1 rounded-full", barClassName ?? "bg-amber-500/80 dark:bg-amber-300/80")}
          style={{ height: `${Math.round(v * 100)}%` }}
        />
      ))}
    </div>
  );
});
