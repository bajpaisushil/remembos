import { ArrowUpRight, Database, FolderSearch, Layers, ScanSearch, ShieldCheck, TriangleAlert, Wrench, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Container } from "@/components/ui/PageHeader";
import { ROUTES } from "@/lib/config";
import { DevToolsGuide } from "./DevToolsGuide";
import { EraseChecklist } from "./EraseChecklist";
import { GuideHero } from "./GuideHero";
import { GuideSection } from "./GuideSection";
import { LiveInspector } from "./LiveInspector";
import { LocationFinder } from "./LocationFinder";
import { MediumCards } from "./MediumCards";
import { ProtectSection } from "./ProtectSection";

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "whats-stored", label: "What's stored where", icon: Layers },
  { id: "find-it", label: "Find it on your computer", icon: FolderSearch },
  { id: "devtools", label: "See it in DevTools", icon: Wrench },
  { id: "inspector", label: "Live inspector", icon: ScanSearch },
  { id: "dont-erase", label: "Don't erase by accident", icon: TriangleAlert },
  { id: "protect", label: "Protect your memories", icon: ShieldCheck },
];

function OnThisPage() {
  return (
    <nav aria-label="On this page" className="mt-10 sm:mt-12">
      <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <li key={id} className="shrink-0">
            <a
              href={`#${id}`}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-zinc-200/90 bg-white/75 px-3.5 text-[13px] font-medium whitespace-nowrap text-zinc-700 shadow-soft transition-[transform,border-color,background-color,color] duration-150 ease-out hover:-translate-y-px hover:border-brand-300 hover:bg-white hover:text-brand-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:border-brand-300/40 dark:hover:bg-white/10 dark:hover:text-brand-100"
            >
              <Icon aria-hidden className="size-3.5 text-brand-500 dark:text-brand-300" />
              {label}
            </a>
          </li>
        ))}
        <li className="shrink-0">
          <Link
            href={ROUTES.explorer}
            className="brand-gradient inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold whitespace-nowrap text-white shadow-soft transition-[transform,filter] duration-150 ease-out hover:-translate-y-px hover:brightness-110"
            data-testid="nav-explorer-link"
          >
            <Database aria-hidden className="size-3.5" />
            Storage explorer
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/**
 * "Where your data lives" — which browser storage Remembos uses for what, where it sits on disk,
 * the way to one memory's file (its "Where is this stored?" panel and the storage explorer), a live
 * read-only inspector, what would erase it by accident, and how to protect it.
 */
export function StorageGuide() {
  return (
    <Container className="pb-4">
      <GuideHero />
      <OnThisPage />

      <GuideSection
        id="whats-stored"
        eyebrow="Storage mediums"
        icon={<Layers aria-hidden />}
        title="What's stored where"
        description="Browsers give every website a few separate storage spaces. Here's each one Remembos touches, what it keeps there, and what happens if it's cleared."
      >
        <MediumCards />
      </GuideSection>

      <GuideSection
        id="find-it"
        eyebrow="On your computer"
        icon={<FolderSearch aria-hidden />}
        title="Find it on your computer"
        description="All of it sits inside your browser's profile folder. Here are the exact folders for your system and browser, with this site's address already filled in."
      >
        <LocationFinder />
      </GuideSection>

      <GuideSection
        id="devtools"
        eyebrow="Inside the browser"
        icon={<Wrench aria-hidden />}
        title="See it in DevTools"
        description="The safest way to look: every desktop browser has built-in developer tools that show this site's storage without touching any files."
      >
        <DevToolsGuide />
      </GuideSection>

      <GuideSection
        id="inspector"
        eyebrow="Live"
        icon={<ScanSearch aria-hidden />}
        title="Live inspector"
        description="Everything this site keeps in this browser at this moment, read straight from the browser. It updates as you add or remove memories — and the storage explorer lets you browse every single record."
      >
        <LiveInspector />
      </GuideSection>

      <GuideSection
        id="dont-erase"
        eyebrow="Avoid surprises"
        icon={<TriangleAlert aria-hidden />}
        title="What erases your memories — and what's safe"
        description="Browsers treat Remembos like any other website's data. These are the everyday actions that delete it, and the ones you can do without worry."
      >
        <EraseChecklist />
      </GuideSection>

      <GuideSection
        id="protect"
        eyebrow="Protect yourself"
        icon={<ShieldCheck aria-hidden />}
        title="Three ways to keep your memories safe"
        description="Do the first one now and then. The other two make surprises much less likely."
      >
        <ProtectSection />
      </GuideSection>
    </Container>
  );
}
