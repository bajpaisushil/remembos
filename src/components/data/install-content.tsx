/**
 * Why installing Remembos as an app is worth it — shared by the Data page card and the Help page.
 * No hooks here, so Server Components can render it too.
 */
import { AppWindow, FileInput, Share2, ShieldCheck, WifiOff, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconChip, type ChipTone } from "./shared";

export interface InstallBenefit {
  icon: ReactNode;
  tone: ChipTone;
  title: string;
  text: string;
}

export const INSTALL_BENEFITS: InstallBenefit[] = [
  { icon: <AppWindow />, tone: "brand", title: "Its own window", text: "Opens from your Dock, taskbar or Home Screen like any app — no tabs, no address bar." },
  { icon: <WifiOff />, tone: "emerald", title: "Works offline", text: "Add, search and open memories without internet." },
  {
    icon: <Share2 />,
    tone: "violet",
    title: "Share → Remembos on Android",
    text: "Share a screenshot, photo, PDF, video or link from any app straight into Remembos.",
  },
  {
    icon: <FileInput />,
    tone: "sky",
    title: "“Open with Remembos” on computers",
    text: "In Chrome and Edge, right-click a file → Open with → Remembos to remember it.",
  },
  {
    icon: <Zap />,
    tone: "amber",
    title: "Quick actions",
    text: "Right-click or long-press the app icon for Upload, Paste, Record voice and Search.",
  },
  {
    icon: <ShieldCheck />,
    tone: "rose",
    title: "Safer storage",
    text: "Browsers protect installed apps' data better — Safari's 7-day clean-up doesn't apply to them.",
  },
];

/** Grid of install benefits with tinted icon chips. */
export function InstallBenefits({ className, columns = 3 }: { className?: string; columns?: 2 | 3 }) {
  return (
    <ul className={cn("grid gap-2.5 sm:grid-cols-2", columns === 3 && "lg:grid-cols-3", className)} data-testid="install-benefits">
      {INSTALL_BENEFITS.map((b) => (
        <li key={b.title} className="flex gap-3 rounded-2xl border border-zinc-200/70 bg-zinc-50/60 p-3.5 dark:border-white/[0.08] dark:bg-white/[0.025]">
          <IconChip tone={b.tone} size="sm">
            {b.icon}
          </IconChip>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-zinc-900 dark:text-white">{b.title}</span>
            <span className="mt-0.5 block text-[13px] leading-snug text-muted">{b.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
