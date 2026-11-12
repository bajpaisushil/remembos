"use client";

/**
 * Preferences for how memories are processed: meaning search, voice transcription, keeping
 * original files, the text reader's languages, and the color theme. Saved in this browser's
 * localStorage (they are preferences, not memories).
 */
import { Check, Languages, Monitor, Moon, SlidersHorizontal, Sun } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import { warmupEmbedder } from "@/lib/ai/embedder";
import { MODELS, OCR_LANG_DEFAULT } from "@/lib/config";
import { useMounted } from "@/lib/hooks";
import { backfillEmbeddings } from "@/lib/search";
import { updateSettings, useSettings, type Settings } from "@/lib/settings";
import { Segmented } from "@/components/ui/Segmented";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { cn, formatBytes } from "@/lib/utils";
import { OCR_LANGUAGES, ocrLanguageNames, parseOcrLanguages } from "./ocr-languages";
import { Panel } from "./shared";

const THEME_OPTIONS: { value: Settings["theme"]; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Match device", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function SettingsPanel() {
  const settings = useSettings();
  // Preferences load from this browser after the first render; show placeholders until then.
  const mounted = useMounted();

  function setSemantic(on: boolean) {
    updateSettings({ semanticSearch: on });
    if (on) {
      warmupEmbedder({ userRequested: true });
      void backfillEmbeddings();
    } else {
      toast.info("Meaning search is off", {
        id: "settings-semantic",
        description: "Search still finds exact words. Downloaded model files stay until you remove them under AI models.",
      });
    }
  }

  function setKeepOriginals(on: boolean) {
    updateSettings({ keepOriginals: on });
    if (!on) {
      toast.info("New files will keep only their text", {
        id: "settings-originals",
        description: "Saves space. Originals you already have stay until you remove them under “Free up space”.",
        action: {
          label: "Free up space",
          onClick: () => document.getElementById("space")?.scrollIntoView({ behavior: "smooth", block: "start" }),
        },
      });
    }
  }

  return (
    <Panel
      id="settings"
      icon={<SlidersHorizontal />}
      tone="violet"
      title="Settings"
      description="Choose how Remembos reads and keeps what you add. These preferences are saved in this browser."
      data-testid="settings-panel"
    >
      {mounted ? (
        <div className="flex flex-col divide-y divide-zinc-200/70 dark:divide-white/[0.08]">
          <div className="pb-4">
            <Switch
              label="Search by meaning"
              description={`Finds memories even when you use different words (“flat rent” finds “apartment lease”). Uses a ${formatBytes(MODELS.embedder.approxBytes, 0)} model, downloaded once.`}
              checked={settings.semanticSearch}
              onCheckedChange={setSemantic}
              data-testid="setting-semantic"
            />
          </div>
          <div className="py-4">
            <Switch
              label="Transcribe voice & videos"
              description={`Turns what's said in recordings and videos into searchable text on your device. Uses a ${formatBytes(MODELS.whisper.approxBytes, 0)} model, downloaded on first use.`}
              checked={settings.transcribeAudio}
              onCheckedChange={(on) => updateSettings({ transcribeAudio: on })}
              data-testid="setting-transcribe"
            />
          </div>
          <div className="py-4">
            <Switch
              label="Keep original files"
              description="Keeps screenshots, PDFs, videos and recordings so you can open them later. Turn off to keep only their text and save space."
              checked={settings.keepOriginals}
              onCheckedChange={setKeepOriginals}
              data-testid="setting-originals"
            />
          </div>
          <div className="py-4">
            <OcrLanguagePicker value={settings.ocrLanguages} />
          </div>
          <div className="pt-4">
            <ThemePicker value={settings.theme} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5" aria-busy="true">
          <span role="status" className="sr-only">
            Loading settings…
          </span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start justify-between gap-6">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40 rounded-full" />
                <Skeleton className="h-3 w-full max-w-md rounded-full" />
              </div>
              <Skeleton className="h-6 w-11 rounded-full" />
            </div>
          ))}
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      )}
    </Panel>
  );
}

function OcrLanguagePicker({ value }: { value: string }) {
  const id = useId();
  const selected = parseOcrLanguages(value || OCR_LANG_DEFAULT);
  const known = new Set(OCR_LANGUAGES.map((l) => l.code));
  const extras = selected.filter((c) => !known.has(c));

  function toggle(code: string) {
    const on = selected.includes(code);
    if (on && selected.length === 1) {
      toast.info("Keep at least one language", {
        id: "settings-ocr-langs",
        description: "The text reader needs a language to read screenshots and scans. Pick another one first.",
      });
      return;
    }
    const next = on ? selected.filter((c) => c !== code) : [...selected, code];
    // Keep a stable, readable order: the listed languages first, then any custom codes.
    const ordered = [...OCR_LANGUAGES.map((l) => l.code).filter((c) => next.includes(c)), ...next.filter((c) => !known.has(c))];
    updateSettings({ ocrLanguages: ordered.join("+") });
  }

  return (
    <fieldset aria-describedby={`${id}-hint`}>
      <legend className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        <Languages aria-hidden className="size-4 text-brand-500 dark:text-brand-300" />
        Languages in your screenshots and scans
      </legend>
      <p id={`${id}-hint`} className="mt-0.5 text-[13px] leading-snug text-muted">
        Now reading <span className="font-medium text-zinc-700 dark:text-zinc-200">{ocrLanguageNames(selected)}</span>. Each extra language is a
        one-time download of a few MB, the next time text is read from an image. Pick only what you need — fewer languages read faster.
      </p>
      <div className="mt-3 flex flex-wrap gap-2" data-testid="setting-ocr-languages">
        {OCR_LANGUAGES.map((lang) => {
          const checked = selected.includes(lang.code);
          return (
            <label key={lang.code} className="relative">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={checked}
                onChange={() => toggle(lang.code)}
                data-testid={`ocr-lang-${lang.code}`}
              />
              <span
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors duration-150 select-none",
                  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500",
                  checked
                    ? "border-brand-500/40 bg-brand-500/10 text-brand-700 dark:border-brand-400/40 dark:bg-brand-400/15 dark:text-brand-100"
                    : "border-zinc-200/90 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:border-white/20 dark:hover:bg-white/10 dark:hover:text-white",
                )}
              >
                {checked ? <Check aria-hidden className="size-3.5" /> : null}
                {lang.name}
              </span>
            </label>
          );
        })}
        {extras.map((code) => (
          <label key={code} className="relative">
            <input type="checkbox" className="peer sr-only" checked onChange={() => toggle(code)} />
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-brand-500/40 bg-brand-500/10 px-3 font-mono text-[12px] font-medium text-brand-700 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 dark:border-brand-400/40 dark:bg-brand-400/15 dark:text-brand-100">
              <Check aria-hidden className="size-3.5" />
              {code}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ThemePicker({ value }: { value: Settings["theme"] }) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p id={labelId} className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Appearance
        </p>
        <p className="mt-0.5 text-[13px] text-muted">Light, dark, or follow your device.</p>
      </div>
      <Segmented<Settings["theme"]>
        aria-label="Appearance"
        value={value}
        onChange={(theme) => updateSettings({ theme })}
        options={THEME_OPTIONS.map((o) => ({ value: o.value, label: o.label, icon: <o.icon /> }))}
        testIdPrefix="setting-theme"
      />
    </div>
  );
}
