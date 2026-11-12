/**
 * The Help page: how Remembos works, what you can add (and every way to add it), how to ask,
 * keyboard shortcuts, questions & answers (phones, privacy, where files are stored) and how to
 * install it as an app. Rendered on the server (static HTML); only the tour button, install button
 * and key hints are client components.
 */
import {
  ArrowRight,
  CalendarClock,
  Camera,
  CircleHelp,
  ClipboardPaste,
  Compass,
  Database,
  Download,
  Globe,
  HardDrive,
  Keyboard,
  Laptop,
  LifeBuoy,
  MapPin,
  MessageCircleQuestion,
  Mic,
  MonitorSmartphone,
  Search,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  StickyNote,
  Tag,
  Trash2,
  Upload,
  UserX,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Accordion, AccordionItem } from "@/components/ui/Accordion";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Kbd } from "@/components/ui/Kbd";
import { KindIcon } from "@/components/ui/KindIcon";
import { Accent, Container, PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { KIND_META, LIMITS, MODELS, ROUTES, searchHref } from "@/lib/config";
import { MEMORY_KINDS } from "@/lib/types";
import { formatBytes } from "@/lib/utils";
import { OfflineSetupSteps } from "@/components/shell/OfflineSetup";
import { HelpTourButton } from "./HelpTourButton";
import { AskScene, DropScene, ReadScene } from "./illustrations";
import { InstallActions } from "./InstallAppCard";
import { InstallBenefits } from "./install-content";
import { Callout, IconChip, StepList, type ChipTone } from "./shared";

const JUMP = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#what-to-add", label: "What you can add" },
  { href: "#ask", label: "Ask like a human" },
  { href: "#shortcuts", label: "Shortcuts" },
  { href: "#faq", label: "Questions & answers" },
  { href: "#install", label: "Install as an app" },
];

const LINK = "font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300";

const STEPS: { title: string; text: ReactNode; scene: ReactNode }[] = [
  {
    title: "Add it in a second",
    text: (
      <>
        One click on Upload, drag files anywhere, or press <Kbd keys={["mod", "v"]} /> — whatever you copied is saved instantly. Screenshots,
        PDFs, videos, voice notes and text all go to the same place.
      </>
    ),
    scene: <DropScene className="h-48" />,
  },
  {
    title: "It's read on your device",
    text: "Words are pulled out of screenshots, scans and video frames, speech is transcribed, and everything is indexed by words and by meaning — inside your browser. Nothing leaves this device.",
    scene: <ReadScene className="h-48" />,
  },
  {
    title: "Ask like a human",
    text: "Type a question the way you'd say it. Remembos finds the memory and even pulls out the exact phone number, amount, link or date for you.",
    scene: <AskScene className="h-48" />,
  },
];

const EXAMPLES = [
  "What's Priya's phone number?",
  "How much was the Northwind invoice?",
  "wifi password",
  "what did we decide about Project Atlas",
  "flight confirmation code",
  "screenshots from last month",
];

const TIPS: { icon: ReactNode; tone: ChipTone; title: string; text: ReactNode }[] = [
  {
    icon: <CalendarClock />,
    tone: "violet",
    title: "Say when",
    text: (
      <>
        Add time words like <Q>yesterday</Q>, <Q>last week</Q>, <Q>last month</Q>, <Q>3 days ago</Q>, <Q>last Tuesday</Q> or <Q>March 2025</Q>{" "}
        to look only in that period.
      </>
    ),
  },
  {
    icon: <Sparkles />,
    tone: "brand",
    title: "Ask for the thing itself",
    text: (
      <>
        Words like <Q>phone number</Q>, <Q>email</Q>, <Q>link</Q>, <Q>amount</Q> or <Q>how much</Q>, and <Q>when</Q> or <Q>due date</Q> get you
        a smart answer card with the exact value — ready to copy.
      </>
    ),
  },
  {
    icon: <Tag />,
    tone: "sky",
    title: "Mention the kind",
    text: (
      <>
        <Q>screenshot</Q>, <Q>photo</Q>, <Q>pdf</Q>, <Q>document</Q>, <Q>video</Q>, <Q>recording</Q>, <Q>voice memo</Q> or <Q>note</Q> nudges
        results toward that kind of memory.
      </>
    ),
  },
  {
    icon: <Search />,
    tone: "emerald",
    title: "Different words are fine",
    text: (
      <>
        With meaning search on, <Q>flat rent</Q> also finds “apartment lease”. Typos are forgiven, and partial words match as you type.
      </>
    ),
  },
];

function Q({ children }: { children: ReactNode }) {
  return <span className="rounded-md bg-zinc-100 px-1.5 py-px font-medium whitespace-nowrap text-zinc-800 dark:bg-white/10 dark:text-zinc-100">{children}</span>;
}

const SHORTCUTS: { keys: ReactNode; label: string; hint: string }[] = [
  {
    keys: <Kbd keys={["mod", "v"]} size="md" />,
    label: "Save your clipboard — instantly",
    hint: "A copied screenshot, text or link is saved on any page, no dialog. Undo is right in the toast.",
  },
  { keys: <Kbd keys={["mod", "k"]} size="md" />, label: "Search and jump anywhere", hint: "Opens the command palette" },
  { keys: <Kbd size="md">/</Kbd>, label: "Start searching", hint: "Also opens the palette" },
  { keys: <Kbd size="md">n</Kbd>, label: "Write a quick note", hint: "When you're not typing in a box" },
  { keys: <Kbd size="md">esc</Kbd>, label: "Close", hint: "Dialogs, menus and the palette" },
];

const WAYS: { icon: ReactNode; tone: ChipTone; title: string; text: ReactNode; testId: string }[] = [
  {
    icon: <Upload />,
    tone: "brand",
    title: "Upload",
    text: "Click Upload at the top — or the big upload area on Home — and pick files. Or drag them anywhere on any page.",
    testId: "help-way-upload",
  },
  {
    icon: <ClipboardPaste />,
    tone: "violet",
    title: "Paste — saved instantly",
    text: (
      <>
        Press <Kbd keys={["mod", "v"]} /> anywhere, or use Paste. Copied screenshots, text and links are saved right away — no dialog. Undo
        is in the toast.
      </>
    ),
    testId: "help-way-paste",
  },
  {
    icon: <Mic />,
    tone: "amber",
    title: "Record your voice",
    text: "Upload ▾ → Record voice (on phones: + → Record). Speak, stop, done — it's transcribed on your device.",
    testId: "help-way-record",
  },
  {
    icon: <Camera />,
    tone: "rose",
    title: "Take a photo",
    text: "On phones and tablets: + → Take photo, for receipts, whiteboards, business cards and labels.",
    testId: "help-way-photo",
  },
  {
    icon: <Share2 />,
    tone: "sky",
    title: "Share from other apps",
    text: "Android, with Remembos installed: Share → Remembos from Photos, Files, Chrome and most apps. On computers: Open with → Remembos.",
    testId: "help-way-share",
  },
  {
    icon: <StickyNote />,
    tone: "emerald",
    title: "Jot a note",
    text: (
      <>
        Upload ▾ → Add note, or press <Kbd>n</Kbd>. Handy for decisions and ideas you&apos;ll want to find later.
      </>
    ),
    testId: "help-way-note",
  },
];

/** `id` = anchor for deep links (e.g. /help/#faq-folder) and its data-testid (help-faq-folder). */
const FAQ: { q: string; a: ReactNode; id?: string }[] = [
  {
    q: "Is anything I add uploaded?",
    a: (
      <>
        <p>
          No. Everything you add is saved in this browser&apos;s own storage on this device. Reading screenshots, transcribing recordings and
          videos, and searching all run right here. There&apos;s no account, no server that stores your things, no analytics and no cookies.
        </p>
      </>
    ),
  },
  {
    id: "faq-phone",
    q: "How do I add things from my phone?",
    a: (
      <>
        <p>Tap the + in the middle of the bottom bar, then:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Upload</strong> — pick photos, screenshots, videos or files.
          </li>
          <li>
            <strong>Take photo</strong> — snap a receipt, whiteboard or card straight from the camera.
          </li>
          <li>
            <strong>Paste</strong> — copy text, a link or a picture in any app, then tap Paste. It&apos;s saved right away.
          </li>
          <li>
            <strong>Record</strong> — record a voice note in Remembos itself.
          </li>
        </ul>
        <p className="mt-2">
          <strong>Android:</strong> install Remembos (see{" "}
          <a href="#install" className={LINK}>
            Install as an app
          </a>
          ), then use <strong>Share → Remembos</strong> in Photos, Files, Chrome and most other apps.
        </p>
        <p className="mt-2">
          <strong>iPhone &amp; iPad:</strong> Apple doesn&apos;t let web apps appear in the share sheet, so use Upload or Paste. Adding Remembos
          to your Home Screen still puts it one tap away.
        </p>
      </>
    ),
  },
  {
    id: "faq-folder",
    q: "Can Remembos open the folder where my file is stored?",
    a: (
      <>
        <p>
          Not directly — no website can. Browsers block websites from opening folders on your computer, to protect you. And even inside that
          folder you wouldn&apos;t find “Invoice.pdf”: IndexedDB, the browser&apos;s built-in database, keeps files as numbered internal pieces
          without names or extensions.
        </p>
        <p className="mt-2">What works instead:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Open original</strong> or <strong>Download</strong> on any memory — you get the exact file back, with its name.
          </li>
          <li>
            <strong>Where is this stored?</strong> on each memory shows its address inside your browser and the real folder on this device,
            with a copy button and how to open it (Finder, File Explorer or your file manager).
          </li>
          <li>
            From that panel, <strong>Show in storage explorer</strong> lands on every record of that memory — or open the{" "}
            <Link href={ROUTES.explorer} className={LINK}>
              storage explorer
            </Link>{" "}
            to browse everything.
          </li>
        </ul>
        <p className="mt-2">Remembos keeps just one copy — it never duplicates your files into another folder, so nothing takes double the space.</p>
      </>
    ),
  },
  {
    q: "What gets downloaded, and from where?",
    a: (
      <>
        <p>Besides the app itself, only the files for three small helpers — once, and only when you first need them:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            {MODELS.ocr.label} — about {formatBytes(MODELS.ocr.approxBytes, 0)} (plus a few MB per extra language), from jsDelivr.
          </li>
          <li>
            {MODELS.embedder.label} — about {formatBytes(MODELS.embedder.approxBytes, 0)}, from jsDelivr and Hugging Face.
          </li>
          <li>
            {MODELS.whisper.label} — about {formatBytes(MODELS.whisper.approxBytes, 0)}, from jsDelivr and Hugging Face.
          </li>
        </ul>
        <p className="mt-2">
          Your browser keeps them, so they aren&apos;t downloaded again. These downloads carry nothing about you or your memories. You can see
          and remove them on{" "}
          <Link href={`${ROUTES.data}#models`} className={LINK}>
            Your data
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    q: "Does it work offline?",
    a: (
      <p>
        Yes. After your first visit, Remembos opens without internet. Adding and searching work offline too, once the helpers you need have
        been downloaded. If a helper isn&apos;t downloaded yet, keyword search still works and the rest catches up when you&apos;re back online.
      </p>
    ),
  },
  {
    q: "What happens if I clear my browsing data?",
    a: (
      <>
        <p>
          Clearing <strong>“Cookies and other site data”</strong> (or “website data”) deletes your memories along with everything else this site
          stored. Clearing only your history or “cached images and files” is usually safe. Safari may also clear data of sites you haven&apos;t
          opened for 7 days — installing Remembos as an app avoids that.
        </p>
        <p className="mt-2">Download a backup before cleaning up, and you can always restore it.</p>
      </>
    ),
  },
  {
    q: "Can I use it on another device?",
    a: (
      <StepList
        steps={[
          <>
            On this device, open{" "}
            <Link href={`${ROUTES.data}#backup`} className={LINK}>
              Your data → Backup
            </Link>{" "}
            and download a backup (.zip).
          </>,
          "Move the file — a cloud drive, AirDrop, email to yourself or a USB stick.",
          "On the other device, open Remembos, go to Your data and choose “Restore from a backup”. Memories you already have there are skipped.",
        ]}
      />
    ),
  },
  {
    q: "Why is the first scan, recording or video slow?",
    a: (
      <p>
        The first time, your browser downloads the text reader or transcriber and gets it ready — that takes a moment, with progress shown at
        the bottom of the screen. After that it&apos;s much faster. Big PDFs, long recordings and videos still take a while because all the work
        happens on your device; your memory is saved straight away and you can keep using Remembos meanwhile.
      </p>
    ),
  },
  {
    q: "How much space can Remembos use?",
    a: (
      <p>
        Browsers give each site a share of your free disk space — often many gigabytes on a computer, less on a phone.{" "}
        <Link href={ROUTES.data} className={LINK}>
          Your data
        </Link>{" "}
        shows exactly how much is used and free, and you&apos;ll get a heads-up at 70% and 90%. To save space, remove original files (text and
        search stay) or turn off “Keep original files”.
      </p>
    ),
  },
  {
    q: "How do I delete everything?",
    a: (
      <p>
        Open{" "}
        <Link href={`${ROUTES.data}#danger`} className={LINK}>
          Your data → Start over
        </Link>
        , choose “Delete everything” and type DELETE to confirm. To remove every last trace, also clear this site&apos;s data in your browser
        settings — the same page has steps for each browser.
      </p>
    ),
  },
];

const INSTALL: { icon: ReactNode; name: string; steps: ReactNode }[] = [
  {
    icon: <Laptop />,
    name: "Chrome or Edge on a computer",
    steps: (
      <>
        Click the <strong>install icon</strong> at the right of the address bar (or <strong>⋮ → Cast, save and share → Install page as app</strong>).
        Afterwards, right-click a file → <strong>Open with → Remembos</strong> to remember it.
      </>
    ),
  },
  {
    icon: <Smartphone />,
    name: "Android",
    steps: (
      <>
        In Chrome tap <strong>⋮ → Install app</strong> (or <strong>Add to Home screen</strong>). Samsung Internet: <strong>☰ → Add page to → Home screen</strong>.
        Then <strong>Share → Remembos</strong> shows up in other apps.
      </>
    ),
  },
  {
    icon: <MonitorSmartphone />,
    name: "iPhone & iPad",
    steps: (
      <>
        In Safari tap <strong>Share</strong> (square with an arrow) → <strong>Add to Home Screen</strong>. The Home Screen app keeps its own storage
        — restore a backup there to bring memories over.
      </>
    ),
  },
  {
    icon: <Globe />,
    name: "Safari on Mac",
    steps: (
      <>
        Choose <strong>File → Add to Dock</strong> (macOS Sonoma or later).
      </>
    ),
  },
  {
    icon: <Compass />,
    name: "Firefox",
    steps: (
      <>
        Firefox on computers doesn&apos;t install websites as apps — keep using it in a tab, or install from Chrome or Edge. On Android:{" "}
        <strong>⋮ → Install</strong>.
      </>
    ),
  },
];

export function HelpScreen() {
  return (
    <Container className="pt-8 pb-12 sm:pt-12">
      <PageHeader
        size="lg"
        eyebrow={
          <>
            <CircleHelp />
            Help
          </>
        }
        title={
          <>
            How can we <Accent>help</Accent>?
          </>
        }
        description="Everything about using Remembos — adding things in a second, asking for them later, and how your memories stay private on this device."
        actions={
          <>
            <HelpTourButton label="Show the welcome tour" data-testid="help-show-tour" />
            <Button href={ROUTES.storage} variant="secondary" leftIcon={<MapPin />}>
              Where your data lives
            </Button>
          </>
        }
      >
        <nav aria-label="Help topics" className="-mx-4 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:px-0">
          <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
            {JUMP.map((j) => (
              <li key={j.href}>
                <a
                  href={j.href}
                  className="inline-flex h-9 items-center rounded-full border border-zinc-200/90 bg-white/70 px-3.5 text-[13px] font-medium whitespace-nowrap text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-white hover:text-zinc-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:border-white/20 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  {j.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </PageHeader>

      <div className="flex flex-col gap-14 sm:gap-16">
        {/* How it works */}
        <section aria-labelledby="how-it-works">
          <SectionHeader id="how-it-works" title="How it works" description="Three steps, all on your device." />
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Card as="li" key={s.title} padding="sm" className="flex flex-col">
                {s.scene}
                <div className="flex items-center gap-2.5 px-1 pt-4">
                  <span className="brand-gradient grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white">{i + 1}</span>
                  <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-white">{s.title}</h3>
                </div>
                <p className="px-1 pt-2 pb-1 text-sm leading-relaxed text-muted">{s.text}</p>
              </Card>
            ))}
          </ol>
        </section>

        {/* What you can add */}
        <section aria-labelledby="what-to-add">
          <SectionHeader
            id="what-to-add"
            title="What you can add"
            description="Like a clipboard that remembers everything: one click to upload, or just paste. It all stays on this device."
          />
          <ul className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="help-ways">
            {WAYS.map((w) => (
              <Card as="li" key={w.title} padding="sm" radius="2xl" className="flex gap-3.5" data-testid={w.testId}>
                <IconChip tone={w.tone}>{w.icon}</IconChip>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-white">{w.title}</h3>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{w.text}</p>
                </div>
              </Card>
            ))}
          </ul>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MEMORY_KINDS.map((k) => {
              const meta = KIND_META[k];
              return (
                <Card as="li" key={k} padding="sm" radius="2xl" className="flex flex-col gap-3" data-testid={`help-kind-${k}`}>
                  <KindIcon kind={k} size="lg" />
                  <div>
                    <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-white">{meta.plural}</h3>
                    <p className="mt-0.5 text-[13px] leading-snug text-muted">{meta.blurb}</p>
                  </div>
                  <p className="mt-auto flex flex-wrap gap-1">
                    {meta.accept.split(",").map((a) => (
                      <span
                        key={a}
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${meta.bg} ${meta.color} ${meta.ring}`}
                      >
                        {a.trim()}
                      </span>
                    ))}
                  </p>
                </Card>
              );
            })}
          </ul>
          <Callout tone="info" icon={<Upload />} className="mt-4">
            Any file type, up to {formatBytes(LIMITS.maxFileBytes, 0)} each (you&apos;ll get a heads-up above {formatBytes(LIMITS.largeFileBytes, 0)}).
            Files Remembos can&apos;t read inside (RVT, ZIP, CAD…) are kept exactly as they are and found by name; Word, Excel,
            PowerPoint and IFC files are searched by the text inside.
            Scanned PDFs: the first {LIMITS.maxOcrPdfPages} pages are read. Recordings: up to {Math.round(LIMITS.maxAudioSeconds / 60)} minutes
            are transcribed. Videos: what&apos;s said is transcribed, and text on screen is read from {LIMITS.maxVideoOcrFrames} moments across the
            video.
          </Callout>
        </section>

        {/* Ask like a human */}
        <section aria-labelledby="ask">
          <SectionHeader id="ask" title="Ask like a human" description="No special syntax. Just say what you're looking for." />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Card className="flex flex-col">
              <div className="flex items-center gap-2.5">
                <IconChip tone="brand" size="sm">
                  <MessageCircleQuestion />
                </IconChip>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-white">Try asking</h3>
              </div>
              <ul className="mt-4 flex flex-col gap-2">
                {EXAMPLES.map((q) => (
                  <li key={q}>
                    <Link
                      href={searchHref(q)}
                      className="group flex items-center gap-2.5 rounded-xl border border-zinc-200/80 bg-white px-3.5 py-2.5 text-sm font-medium text-zinc-800 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-brand-400/50 hover:shadow-soft dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-100 dark:hover:border-brand-400/40"
                    >
                      <Search aria-hidden className="size-4 shrink-0 text-brand-500 dark:text-brand-300" />
                      <span className="min-w-0 flex-1">{q}</span>
                      <ArrowRight aria-hidden className="size-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[13px] text-muted">
                No memories yet? Load the sample memories from the welcome tour to try these.
              </p>
            </Card>
            <ul className="grid gap-3 sm:grid-cols-2">
              {TIPS.map((t) => (
                <Card as="li" key={t.title} padding="sm" radius="2xl">
                  <div className="flex items-center gap-2.5">
                    <IconChip tone={t.tone} size="sm">
                      {t.icon}
                    </IconChip>
                    <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-white">{t.title}</h3>
                  </div>
                  <p className="mt-3 text-[13.5px] leading-relaxed text-muted">{t.text}</p>
                </Card>
              ))}
            </ul>
          </div>
        </section>

        {/* Keyboard shortcuts */}
        <section aria-labelledby="shortcuts">
          <SectionHeader id="shortcuts" title="Keyboard shortcuts" description="Handy on a computer — everything also works with a tap." />
          <Card padding="none" className="overflow-hidden">
            <dl className="divide-y divide-zinc-200/70 dark:divide-white/[0.08]" data-testid="help-shortcuts">
              {SHORTCUTS.map((s) => (
                <div key={s.label} className="flex items-center gap-4 px-5 py-3.5 sm:px-6">
                  <dt className="flex w-24 shrink-0 items-center sm:w-28">{s.keys}</dt>
                  <dd className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{s.label}</span>
                    <span className="block text-[13px] text-muted">{s.hint}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
          <p className="mt-3 flex items-center gap-2 text-[13px] text-muted">
            <Keyboard aria-hidden className="size-4" />
            On Windows and Linux, use Ctrl where you see ⌘.
          </p>
        </section>

        {/* Questions & answers */}
        <section aria-labelledby="faq">
          <SectionHeader
            id="faq"
            title="Questions & answers"
            description="Straight answers about adding things, privacy, and where your memories are kept."
            actions={
              <Button href={ROUTES.storage} variant="ghost" size="sm" rightIcon={<ArrowRight />}>
                Full storage guide
              </Button>
            }
          />
          <Accordion>
            {FAQ.map((f, i) => (
              <AccordionItem
                key={f.q}
                id={f.id}
                title={f.q}
                name="help-faq"
                defaultOpen={i === 0}
                className={f.id ? "scroll-mt-24" : undefined}
                data-testid={f.id ? `help-${f.id}` : `help-faq-${i + 1}`}
              >
                {f.a}
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        {/* Use it without internet */}
        <section aria-labelledby="offline" data-testid="help-offline">
          <Card>
            <h2 id="offline" className="scroll-mt-24 text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
              Use it without internet
            </h2>
            <p className="mt-1 mb-5 max-w-2xl text-sm text-muted">
              Your memories never need the internet. The app itself and its AI models download once — do these steps while you&apos;re
              still online, then switching Wi-Fi off changes nothing.
            </p>
            <OfflineSetupSteps />
          </Card>
        </section>

        {/* Install as an app */}
        <section aria-labelledby="install" data-testid="help-install">
          <Card className="relative overflow-hidden">
            <div aria-hidden className="absolute -top-24 -right-20 size-64 rounded-full bg-[radial-gradient(closest-side,rgb(139_92_246/0.18),transparent)]" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-2xl">
                <IconChip tone="brand" size="lg">
                  <Download />
                </IconChip>
                <h2 id="install" className="mt-4 scroll-mt-24 text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
                  Install as an app
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Free and instant, no app store — and your memories stay right where they are. Installed, Remembos gets its own window, works
                  offline, takes things shared from other apps on Android, opens files on computers, and browsers protect its storage better.
                </p>
              </div>
              <InstallActions testIdPrefix="help-install" className="shrink-0" />
            </div>
            <InstallBenefits className="relative mt-6" />
            <h3 className="relative mt-8 text-sm font-semibold text-zinc-900 dark:text-white">How to install</h3>
            <div className="relative mt-3">
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {INSTALL.map((p) => (
                  <li key={p.name} className="rounded-2xl border border-zinc-200/70 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="flex items-center gap-2.5">
                      <IconChip tone="neutral" size="sm">
                        {p.icon}
                      </IconChip>
                      <h4 className="text-sm font-semibold text-zinc-900 dark:text-white">{p.name}</h4>
                    </div>
                    <p className="mt-2.5 text-[13px] leading-relaxed text-muted [&_strong]:font-medium [&_strong]:text-zinc-800 dark:[&_strong]:text-zinc-200">
                      {p.steps}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </section>

        {/* More help */}
        <section aria-labelledby="more-help">
          <h2 id="more-help" className="sr-only">
            More help
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <LinkCard href={ROUTES.storage} icon={<HardDrive />} title="Where your data lives" text="Which browser storage holds your memories, where it sits on disk, and what would erase it." />
            <LinkCard href={ROUTES.explorer} icon={<Database />} title="Storage explorer" text="Every stored record, read-only — open or download any original file." />
            <LinkCard href={ROUTES.data} icon={<MapPin />} title="Your data" text="Storage meter, backups, installing, AI models, settings — and starting over." />
            <Card className="flex flex-col gap-3">
              <IconChip tone="violet">
                <LifeBuoy />
              </IconChip>
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white">New here?</h3>
              <p className="text-sm leading-relaxed text-muted">Take the one-minute welcome tour, with sample memories to play with.</p>
              <div className="mt-auto pt-1">
                <HelpTourButton variant="secondary" size="sm" label="Show the tour" data-testid="help-show-tour-card" />
              </div>
            </Card>
          </div>
          <p className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-center text-[13px] text-muted">
            <span className="flex items-center gap-1.5">
              <ShieldCheck aria-hidden className="size-4 text-emerald-500" /> No uploads
            </span>
            <span className="flex items-center gap-1.5">
              <WifiOff aria-hidden className="size-4 text-emerald-500" /> Works offline
            </span>
            <span className="flex items-center gap-1.5">
              <UserX aria-hidden className="size-4 text-emerald-500" /> Free, no account
            </span>
            <span className="flex items-center gap-1.5">
              <Trash2 aria-hidden className="size-4 text-emerald-500" /> Delete anytime
            </span>
          </p>
        </section>
      </div>
    </Container>
  );
}

function LinkCard({ href, icon, title, text }: { href: string; icon: ReactNode; title: string; text: string }) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-3xl border border-zinc-200/70 bg-white p-5 shadow-card transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-zinc-300/80 hover:shadow-lift sm:p-6 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20"
    >
      <IconChip tone="brand">{icon}</IconChip>
      <span className="flex items-center gap-1.5 text-base font-semibold text-zinc-900 dark:text-white">
        {title}
        <ArrowRight aria-hidden className="size-4 text-zinc-400 transition-transform duration-200 group-hover:translate-x-0.5" />
      </span>
      <span className="text-sm leading-relaxed text-muted">{text}</span>
    </Link>
  );
}
