// Voice recordings → transcript with local Whisper (or a transcript file read as text), plus a waveform preview.
import { LIMITS } from "../config";
import { getSettings } from "../settings";
import type { Extracted, ExtractContext } from "./context";
import { isTranscriptName } from "./detect";
import { IngestError, throwIfAborted } from "./errors";
import { extractTranscriptFile } from "./extract-text";
import { makeWaveformThumb } from "./thumbnail";
import { decodeAudio, tooLongMessage, transcribeSamples, whisperStatus } from "./transcribe";

/** Duration from the file's metadata without decoding it (undefined when the browser can't tell). */
export function probeDuration(blob: Blob, timeoutMs = 6000): Promise<number | undefined> {
  if (typeof document === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement("audio");
    let settled = false;
    const done = (value: number | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined);
    el.onerror = () => done(undefined);
    el.src = url;
  });
}

export async function extractVoice(blob: Blob, ctx: ExtractContext): Promise<Extracted> {
  if (isTranscriptName(ctx.name)) {
    ctx.setStage("reading", "Reading transcript…");
    return extractTranscriptFile(blob);
  }

  if (!getSettings().transcribeAudio) {
    ctx.setStage("reading", "Saving recording…");
    const durationSec = await probeDuration(blob);
    return { text: "", durationSec, emptyNote: "Transcription is off — turn it on in Your data" };
  }

  ctx.setStage("reading", "Checking the recording…");
  const probed = await probeDuration(blob);
  if (probed !== undefined && probed > LIMITS.maxAudioSeconds + 1) throw new IngestError(tooLongMessage(probed));
  throwIfAborted(ctx.signal);

  return ctx.heavy(async () => {
    ctx.setStage("reading", "Decoding audio…");
    const { samples, durationSec } = await decodeAudio(blob, ctx.signal);
    if (durationSec > LIMITS.maxAudioSeconds + 1) throw new IngestError(tooLongMessage(durationSec));
    const thumb = await makeWaveformThumb(samples).catch(() => undefined);
    throwIfAborted(ctx.signal);

    ctx.setStage("transcribing", whisperStatus.get().state === "ready" ? "Transcribing…" : "Getting the voice transcriber ready…");
    const stop = whisperStatus.subscribe(() => {
      const s = whisperStatus.get();
      if (s.state === "loading") ctx.setProgress(s.progress ?? 0, "Getting the voice transcriber ready…");
    });
    let text: string;
    try {
      text = await transcribeSamples(samples, (p) => ctx.setProgress(p, "Transcribing…"), ctx.signal);
    } finally {
      stop();
    }
    return { text, durationSec, thumb, emptyNote: "No speech found in this recording" };
  });
}
