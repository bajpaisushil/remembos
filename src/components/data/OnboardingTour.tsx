"use client";

/**
 * The four-step welcome tour (opened from the Help page): add anything in a second → read on your
 * device → ask like a human → your browser is the vault. Swipe, use the arrow keys, the dots or the
 * buttons to move between steps. Ends with "Try sample memories" or "Start adding"; "Skip" is
 * always there.
 */
import { ArrowLeft, ArrowRight, Cloud, Download, EyeOff, FolderSearch, Mic, ShieldCheck, Sparkles, Upload, WifiOff } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { MODELS, ROUTES } from "@/lib/config";
import { requestPersistence, useStorageInfo } from "@/lib/storage/monitor";
import { MEMORY_KINDS } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Kbd } from "@/components/ui/Kbd";
import { KindBadge } from "@/components/ui/KindIcon";
import { Accent } from "@/components/ui/PageHeader";
import { cn, formatBytes, navigate } from "@/lib/utils";
import { AskScene, DropScene, ReadScene, VaultScene } from "./illustrations";

interface Step {
  key: string;
  name: string;
  title: ReactNode;
  scene: ReactNode;
  body: ReactNode;
}

const SCENE = "h-44 sm:h-52";
const SWIPE_PX = 48;

function PersistButton() {
  const info = useStorageInfo();
  const [state, setState] = useState<"idle" | "asking" | "granted" | "denied">("idle");
  const protectedNow = state === "granted" || info?.persisted === true;

  async function ask() {
    setState("asking");
    const ok = await requestPersistence();
    setState(ok ? "granted" : "denied");
  }

  if (protectedNow) {
    return (
      <Badge tone="success" icon={<ShieldCheck />} data-testid="onboarding-persisted">
        Your browser will keep your memories
      </Badge>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="soft" size="sm" leftIcon={<ShieldCheck />} loading={state === "asking"} onClick={ask} data-testid="onboarding-persist">
        Keep my data safe
      </Button>
      {state === "denied" ? (
        <p className="text-xs text-muted">Your browser said “not yet” — no problem. A backup now and then keeps you covered.</p>
      ) : null}
    </div>
  );
}

const STEPS: Step[] = [
  {
    key: "drop",
    name: "Add anything in a second",
    title: (
      <>
        Add <Accent>anything</Accent> in a second
      </>
    ),
    scene: <DropScene className={SCENE} />,
    body: (
      <>
        <p>
          Like a clipboard that never forgets: screenshots, PDFs, videos, voice notes, copied text and links all go to one place.
        </p>
        <ul className="mt-3 space-y-1.5 text-[13.5px]">
          <li className="flex gap-2.5">
            <Upload aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500 dark:text-brand-300" />
            <span>One click on Upload — or drag files anywhere on the page.</span>
          </li>
          <li className="flex gap-2.5">
            <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500 dark:text-brand-300" />
            <span>
              Press <Kbd keys={["mod", "v"]} /> — whatever you copied is saved instantly.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Mic aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500 dark:text-brand-300" />
            <span>Record a voice note right here, or take a photo on your phone.</span>
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {MEMORY_KINDS.map((k) => (
            <KindBadge key={k} kind={k} size="sm" />
          ))}
        </div>
      </>
    ),
  },
  {
    key: "read",
    name: "Read on your device",
    title: (
      <>
        Read on <Accent>your</Accent> device
      </>
    ),
    scene: <ReadScene className={SCENE} />,
    body: (
      <>
        <p>
          Remembos reads the words in your screenshots and scans, transcribes recordings and understands what things mean — all inside your
          browser. Nothing is uploaded, ever.
        </p>
        <p className="mt-3 flex items-start gap-2 text-[13px]">
          <WifiOff aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500 dark:text-brand-300" />
          <span>
            The reading helpers download once (about {formatBytes(MODELS.ocr.approxBytes, 0)}–{formatBytes(MODELS.whisper.approxBytes, 0)} each, only
            when needed), then work offline.
          </span>
        </p>
      </>
    ),
  },
  {
    key: "ask",
    name: "Ask like you'd ask a friend",
    title: (
      <>
        Ask like you&apos;d ask a <Accent>friend</Accent>
      </>
    ),
    scene: <AskScene className={SCENE} />,
    body: (
      <>
        <p>Type it the way you&apos;d say it — you get the exact answer, not just a pile of files.</p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {["Priya's phone number", "invoice from last month", "that wifi password"].map((q) => (
            <li
              key={q}
              className="rounded-full border border-zinc-200/90 bg-white px-2.5 py-1 text-[12.5px] font-medium text-zinc-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-200"
            >
              “{q}”
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-[13px]">
          Search from anywhere with <Kbd keys={["mod", "k"]} />
        </p>
      </>
    ),
  },
  {
    key: "vault",
    name: "Your browser is the vault",
    title: (
      <>
        Your browser is the <Accent>vault</Accent>
      </>
    ),
    scene: <VaultScene className={SCENE} />,
    body: (
      <>
        <p>Your memories live only in this browser, on this device. No cloud copy — that&apos;s what keeps them private. It also means:</p>
        <ul className="mt-3 space-y-2 text-[13.5px]">
          <li className="flex gap-2.5">
            <Cloud aria-hidden className="mt-0.5 size-4 shrink-0 text-rose-500 dark:text-rose-300" />
            <span>
              Clearing this site&apos;s data (<span className="font-medium text-zinc-700 dark:text-zinc-200">“cookies and site data”</span>) erases
              them.
            </span>
          </li>
          <li className="flex gap-2.5">
            <EyeOff aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-500 dark:text-amber-300" />
            <span>A private or incognito window forgets everything when it closes.</span>
          </li>
          <li className="flex gap-2.5">
            <Download aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-500 dark:text-emerald-300" />
            <span>Download a backup now and then from Your data — one file, restore anywhere.</span>
          </li>
          <li className="flex gap-2.5">
            <FolderSearch aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500 dark:text-brand-300" />
            <span>Curious where a file is kept? Every memory has a “Where is this stored?” panel.</span>
          </li>
        </ul>
        <div className="mt-4">
          <PersistButton />
        </div>
      </>
    ),
  },
];

const LAST = STEPS.length - 1;

export interface OnboardingTourProps {
  open: boolean;
  onClose: () => void;
}

export function OnboardingTour({ open, onClose }: OnboardingTourProps) {
  const [step, setStep] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  const [sampleBusy, setSampleBusy] = useState(false);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setStep(0);
  }

  const primaryRef = useRef<HTMLButtonElement>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  // Height of the visible slide, so short steps don't leave a tall empty gap.
  const [height, setHeight] = useState<number | null>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const moved = useRef(false);

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(LAST, next));
    if (clamped === step) return;
    moved.current = true;
    setStep(clamped);
  };

  // After moving with the buttons/keys, keep keyboard focus on the main action of the new step.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    primaryRef.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    const el = slideRefs.current[step];
    if (!open || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [step, open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable='true']")) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(step + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(step - 1);
    }
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse") return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    go(dx < 0 ? step + 1 : step - 1);
  }

  async function trySamples() {
    setSampleBusy(true);
    try {
      const { loadSampleData } = await import("@/lib/storage/sample");
      await loadSampleData();
      onClose();
    } catch {
      // loadSampleData already explained what went wrong; stay on the last step so they can retry or skip.
    } finally {
      setSampleBusy(false);
    }
  }

  function startAdding() {
    onClose();
    navigate(ROUTES.home);
  }

  const current = STEPS[step];

  return (
    <Dialog open={open} onClose={onClose} aria-label="Welcome to Remembos" size="md" hideClose padded={false} data-testid="onboarding">
      <div onKeyDown={onKeyDown} className="flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 pt-3 sm:px-6 sm:pt-5">
          <p className="text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase dark:text-brand-300">
            Welcome <span className="text-muted">·</span> {step + 1} of {STEPS.length}
          </p>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="onboarding-skip">
            Skip
          </Button>
        </div>

        <p aria-live="polite" className="sr-only">
          Step {step + 1} of {STEPS.length}: {current.name}
        </p>

        <div
          className="touch-pan-y overflow-hidden transition-[height] duration-300 ease-out-soft motion-reduce:transition-none"
          style={height ? { height } : undefined}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            swipe.current = null;
          }}
          data-testid="onboarding-slides"
        >
          <div
            className="flex items-start transition-transform duration-300 ease-out-soft motion-reduce:transition-none"
            style={{ transform: `translateX(-${step * 100}%)` }}
          >
            {STEPS.map((s, i) => (
              <section
                key={s.key}
                ref={(el) => {
                  slideRefs.current[i] = el;
                }}
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${STEPS.length}: ${s.name}`}
                aria-hidden={i !== step}
                inert={i !== step}
                data-testid={`onboarding-step-${i + 1}`}
                className="w-full shrink-0 px-5 pt-3 pb-5 sm:px-6"
              >
                {s.scene}
                <h2 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-[26px] dark:text-white">{s.title}</h2>
                <div className="mt-2 text-[15px] leading-relaxed text-muted">{s.body}</div>
              </section>
            ))}
          </div>
        </div>

        <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-zinc-200/70 bg-elevated px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-white/[0.08]">
          <div className="flex items-center justify-center gap-1.5 sm:justify-start" role="group" aria-label="Tour steps">
            {STEPS.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onClick={() => go(i)}
                aria-label={`Step ${i + 1}: ${s.name}`}
                aria-current={i === step ? "step" : undefined}
                className="grid h-6 place-items-center px-0.5"
              >
                <span
                  className={cn(
                    "block h-2 rounded-full transition-[width,background-color] duration-300 ease-out-soft",
                    i === step ? "brand-gradient w-6" : "w-2 bg-zinc-300 hover:bg-zinc-400 dark:bg-white/20 dark:hover:bg-white/35",
                  )}
                />
              </button>
            ))}
          </div>

          {step < LAST ? (
            <div className="flex items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
              {step > 0 ? (
                <Button variant="ghost" leftIcon={<ArrowLeft />} onClick={() => go(step - 1)} data-testid="onboarding-back">
                  Back
                </Button>
              ) : null}
              <Button ref={primaryRef} rightIcon={<ArrowRight />} onClick={() => go(step + 1)} data-autofocus data-testid="onboarding-next">
                Next
              </Button>
            </div>
          ) : (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <Button variant="secondary" leftIcon={<Upload />} onClick={startAdding} disabled={sampleBusy} data-testid="onboarding-start">
                Start adding
              </Button>
              <Button ref={primaryRef} leftIcon={<Sparkles />} loading={sampleBusy} onClick={trySamples} data-testid="onboarding-sample">
                Try sample memories
              </Button>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
