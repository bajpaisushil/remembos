"use client";

import { CircleAlert, Download, FileAudio, Mic, MicOff, Pause, ShieldCheck, Square } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { KindIcon } from "@/components/ui/KindIcon";
import { Spinner } from "@/components/ui/Spinner";
import { LIMITS } from "@/lib/config";
import { addFiles } from "@/lib/ingest/add-files";
import {
  cancelRecording,
  isRecordingSupported,
  pauseRecording,
  recorderState,
  resumeRecording,
  startRecording,
  stopRecording,
  type RecorderState,
} from "@/lib/recorder";
import { useStore } from "@/lib/store";
import { recorderOpen } from "@/lib/ui-state";
import { cn, downloadBlob, formatDuration } from "@/lib/utils";
import { KIND_ACCEPT, requestFiles } from "./pick";

/** Bars in the live level meter (a rolling history, newest on the right). */
const BARS = 32;
const SILENT: number[] = Array.from({ length: BARS }, () => 0);
/** Closing a recording at least this long asks first. */
const CONFIRM_AFTER_SEC = 5;
/** Show a countdown when this close to the length limit. */
const COUNTDOWN_SEC = 60;
const SAVE_TITLE = "Voice memo saved — transcribing on this device…";

/**
 * In-app voice recorder, driven by `recorderOpen` (header ▾ Record voice, the home panel, the mobile add
 * sheet, the app shortcut). Big record button, live level meter, timer, pause/resume, Stop & save → the
 * recording becomes a "voice" memory and is transcribed locally. Bottom sheet on phones. Mounted once by
 * the app shell; takes no props. Every open starts a fresh panel; the microphone is always released on close.
 */
export function VoiceRecorderDialog() {
  const open = useStore(recorderOpen);
  const [session, setSession] = useState(open ? 1 : 0);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSession((n) => n + 1);
  }
  if (session === 0) return null;
  return <Recorder key={session} open={open} />;
}

/** Rolling history of input levels while recording (frozen while paused). */
function useLevelHistory(active: boolean): number[] {
  const [levels, setLevels] = useState<number[]>(SILENT);
  useEffect(() => {
    if (!active) return;
    return recorderState.subscribe(() => {
      const { status, level } = recorderState.get();
      if (status === "recording") setLevels((prev) => [...prev.slice(1), Number.isFinite(level) ? level : 0]);
    });
  }, [active]);
  return levels;
}

/** The recorder already reports a speech-friendly 0..1 (decibel) level; keep a sliver visible in silence. */
function barScale(level: number): number {
  return Math.max(0.08, Math.min(1, level));
}

const LevelMeter = memo(function LevelMeter({ levels, live }: { levels: number[]; live: boolean }) {
  return (
    <div aria-hidden className="flex h-14 w-full max-w-xs items-center justify-center gap-[3px]">
      {levels.map((level, i) => (
        <span
          key={i}
          className={cn(
            "h-full w-1 rounded-full transition-transform duration-100 ease-out motion-reduce:transition-none",
            live
              ? "bg-linear-to-t from-indigo-500 via-violet-500 to-fuchsia-500 dark:from-indigo-400 dark:via-violet-400 dark:to-fuchsia-400"
              : "bg-zinc-300 dark:bg-white/15",
          )}
          style={{ transform: `scaleY(${barScale(level)})` }}
        />
      ))}
    </div>
  );
});

function statusText(status: RecorderState["status"], saving: boolean): string {
  if (saving || status === "stopping") return "Saving…";
  switch (status) {
    case "requesting":
      return "Allow microphone access in your browser…";
    case "recording":
      return "Recording";
    case "paused":
      return "Paused";
    case "error":
      return "Couldn't start recording";
    default:
      return "Ready when you are";
  }
}

function Recorder({ open }: { open: boolean }) {
  const rec = useStore(recorderState);
  const [supported] = useState(isRecordingSupported);
  const [saving, setSaving] = useState(false);
  /** A finished recording that couldn't be stored (kept so it can be downloaded or retried). */
  const [unsaved, setUnsaved] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);

  const live = rec.status === "recording" || rec.status === "paused";
  const stopping = saving || rec.status === "stopping";
  const levels = useLevelHistory(rec.status === "recording");
  const seconds = Math.floor(rec.elapsed);
  const remaining = Math.max(0, LIMITS.maxRecordingSeconds - seconds);

  // Closed from anywhere (or this panel goes away): never leave the microphone on.
  useEffect(() => {
    if (!open) cancelRecording();
  }, [open]);
  useEffect(() => () => cancelRecording(), []);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  async function store(file: File): Promise<boolean> {
    try {
      // Validation, storage-space checks and their toasts live in ingest; the batch toast then follows
      // transcription through to "Remembered".
      const ids = await addFiles([file], { loadingTitle: SAVE_TITLE });
      return ids.length > 0;
    } catch (err) {
      console.error("[remembos] could not save the recording", err);
      return false;
    }
  }

  async function save() {
    if (stopping) return;
    setSaving(true);
    setConfirming(false);
    try {
      const file = unsaved ?? (await stopRecording());
      if (!file) {
        // Null also means the recorder already ended by itself (time limit, mic unplugged) and saved it —
        // it closes this dialog and explains in that case.
        if (recorderOpen.get()) {
          toast.info("Nothing was recorded", { description: "Press the microphone, say what you want to remember, then Stop & save." });
        }
        return;
      }
      if (await store(file)) {
        setUnsaved(null);
        recorderOpen.set(false);
      } else {
        setUnsaved(file);
      }
    } catch (err) {
      console.error("[remembos] could not finish the recording", err);
      toast.error("Couldn't finish the recording", { description: "Please try again." });
    } finally {
      setSaving(false);
    }
  }

  async function start() {
    setUnsaved(null);
    setConfirming(false);
    try {
      await startRecording();
    } catch (err) {
      // The recorder explains permission/device problems itself (toast + error state).
      console.warn("[remembos] could not start recording", err);
    }
  }

  function primary() {
    if (rec.status === "recording") pauseRecording();
    else if (rec.status === "paused") resumeRecording();
    else if (rec.status === "idle" || rec.status === "error") void start();
  }

  function discard() {
    cancelRecording();
    setConfirming(false);
    setUnsaved(null);
    recorderOpen.set(false);
  }

  /** Esc, backdrop, close button and Cancel: ask before throwing away anything worth keeping. */
  function requestClose() {
    if (stopping) return;
    if (confirming) {
      setConfirming(false);
      return;
    }
    if ((live && seconds >= CONFIRM_AFTER_SEC) || unsaved) {
      setConfirming(true);
      return;
    }
    discard();
  }

  function chooseFile() {
    // Opens the picker inside this click (keeps the browser's user activation), then gets out of the way.
    requestFiles(KIND_ACCEPT.voice);
    discard();
  }

  const busy = stopping || rec.status === "requesting";
  const bigLabel =
    rec.status === "recording" ? "Pause" : rec.status === "paused" ? "Resume" : rec.status === "requesting" ? "Starting…" : "Start recording";

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      dismissible={!stopping}
      title="Record a voice note"
      description={
        <span className="flex items-start gap-1.5">
          <ShieldCheck aria-hidden className="mt-[0.2em] size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          Audio stays on this device and is transcribed here — find it later by any word you said.
        </span>
      }
      icon={<KindIcon kind="voice" size="lg" />}
      size="md"
      data-testid="voice-recorder"
      footer={
        supported ? (
          <>
            {!live && !unsaved ? (
              <Button variant="ghost" leftIcon={<FileAudio />} onClick={chooseFile} disabled={busy} className="sm:mr-auto">
                Choose a file instead
              </Button>
            ) : null}
            <Button variant="secondary" onClick={requestClose} disabled={stopping} data-testid="recorder-cancel">
              Cancel
            </Button>
            <Button
              leftIcon={<Square className="fill-current" />}
              onClick={() => void save()}
              loading={stopping}
              disabled={!live && !unsaved}
              data-testid="recorder-stop"
            >
              {stopping ? "Saving…" : unsaved ? "Save recording" : "Stop & save"}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={discard} data-testid="recorder-cancel">
            Close
          </Button>
        )
      }
    >
      {!supported ? (
        <div data-testid="recorder-unsupported" className="flex flex-col items-center gap-3 py-2 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-zinc-900/5 text-zinc-500 dark:bg-white/10 dark:text-zinc-300">
            <MicOff aria-hidden className="size-7" />
          </span>
          <p className="text-base font-semibold text-zinc-900 dark:text-white">Recording isn&apos;t available in this browser</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted">
            It may not allow microphone access here, or the page isn&apos;t on a secure (https) address. Record with
            your phone&apos;s or computer&apos;s voice recorder instead, then add the file — it&apos;s transcribed right
            here, on your device.
          </p>
          <Button variant="soft" leftIcon={<FileAudio />} onClick={chooseFile} data-autofocus className="mt-1">
            Choose an audio file
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 pt-1 pb-2 text-center">
          <div>
            <p
              aria-live="polite"
              className={cn(
                "inline-flex items-center gap-2 text-sm font-medium",
                rec.status === "recording"
                  ? "text-rose-600 dark:text-rose-400"
                  : rec.status === "error"
                    ? "text-rose-700 dark:text-rose-300"
                    : "text-muted",
              )}
            >
              {rec.status === "recording" ? (
                <span aria-hidden className="size-2 animate-pulse-dot rounded-full bg-rose-500 text-rose-500" />
              ) : busy ? (
                <Spinner size="xs" />
              ) : null}
              {statusText(rec.status, saving)}
            </p>
            <p
              role="timer"
              aria-label="Recording length"
              data-testid="recorder-timer"
              className="mt-1 text-5xl font-semibold tracking-tight text-zinc-900 tabular-nums dark:text-white"
            >
              {formatDuration(seconds)}
            </p>
            <p className={cn("mt-1 text-xs", live && remaining <= COUNTDOWN_SEC ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted")}>
              {live && remaining <= COUNTDOWN_SEC
                ? `${formatDuration(remaining)} left`
                : `Up to ${Math.round(LIMITS.maxRecordingSeconds / 60)} minutes`}
            </p>
          </div>

          <LevelMeter levels={levels} live={rec.status === "recording"} />

          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={primary}
              disabled={busy || !!unsaved}
              aria-label={bigLabel}
              data-autofocus
              data-testid="recorder-start"
              data-status={rec.status}
              className={cn(
                "relative grid size-20 place-items-center rounded-full text-white sm:size-24",
                "transition-[transform,background-color,box-shadow,opacity] duration-200 ease-out motion-reduce:transition-none",
                "hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-60",
                "focus-visible:outline-offset-4",
                rec.status === "recording"
                  ? "bg-rose-500 shadow-[0_12px_32px_-10px_rgb(244_63_94/0.8)] hover:bg-rose-600"
                  : "brand-gradient shadow-[0_12px_32px_-10px_rgb(139_92_246/0.8)] hover:brightness-110",
              )}
            >
              {rec.status === "recording" ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -inset-2 rounded-full bg-rose-500/20 transition-transform duration-100 ease-out motion-reduce:hidden"
                  style={{ transform: `scale(${1 + barScale(rec.level) * 0.2})` }}
                />
              ) : null}
              <span className="relative">
                {busy ? (
                  <Spinner size="lg" className="text-white" />
                ) : rec.status === "recording" ? (
                  <Pause aria-hidden className="size-8 fill-current sm:size-9" />
                ) : (
                  <Mic aria-hidden className="size-8 sm:size-9" />
                )}
              </span>
            </button>
            <span aria-hidden className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {bigLabel}
            </span>
          </div>

          {rec.status === "error" && rec.error ? (
            <p role="alert" className="flex max-w-sm items-start gap-2 rounded-xl bg-rose-500/10 px-3 py-2 text-left text-[13px] text-rose-800 dark:bg-rose-400/10 dark:text-rose-200">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {rec.error}
            </p>
          ) : null}

          {unsaved && !confirming ? (
            <div role="alert" className="w-full max-w-sm rounded-2xl bg-amber-500/10 p-3 text-left text-[13px] text-amber-900 dark:bg-amber-400/10 dark:text-amber-100">
              <p className="flex items-start gap-2">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                This recording couldn&apos;t be stored here right now. Download it so it isn&apos;t lost — you can add the
                file again later.
              </p>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Download />}
                onClick={() => downloadBlob(unsaved, unsaved.name)}
                className="mt-2.5"
                data-testid="recorder-download"
              >
                Download recording
              </Button>
            </div>
          ) : null}

          {confirming ? (
            <div
              role="alert"
              className="w-full max-w-sm rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-3.5 text-left dark:border-rose-400/20 dark:bg-rose-400/10"
            >
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                {unsaved ? "Close without saving?" : "Discard this recording?"}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                {unsaved
                  ? "The recording hasn't been stored. Download it first if you want to keep it."
                  : `${formatDuration(seconds)} of audio will be lost.`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button ref={keepRef} size="sm" variant="secondary" onClick={() => setConfirming(false)} data-testid="recorder-keep">
                  {unsaved ? "Go back" : "Keep recording"}
                </Button>
                <Button size="sm" variant="danger" onClick={discard} data-testid="recorder-discard">
                  {unsaved ? "Close anyway" : "Discard"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
