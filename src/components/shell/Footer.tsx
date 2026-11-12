import { Lock } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { ROUTES } from "@/lib/config";
import { ThemeSwitcher } from "./ThemeToggle";

const LINKS = [
  { href: ROUTES.help, label: "Help" },
  { href: ROUTES.storage, label: "Where your data lives" },
  { href: ROUTES.data, label: "Your data" },
];

/** Site footer: privacy promise, key links, theme switcher. */
export function Footer() {
  return (
    <footer className="mt-20 border-t border-zinc-200/60 dark:border-white/[0.07]" data-testid="site-footer">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Logo size={24} />
          <p className="mt-4 flex gap-2.5 text-sm leading-relaxed text-muted">
            <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              Your memories never leave this browser. Reading, transcribing and searching all happen right here on your
              device.
            </span>
          </p>
        </div>

        <div className="flex flex-col gap-5 md:items-end">
          <nav aria-label="Footer">
            <ul className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
              {LINKS.map((l, i) => (
                <li key={l.href} className="flex items-center gap-1">
                  {i > 0 ? (
                    <span aria-hidden className="text-zinc-300 dark:text-zinc-700">
                      ·
                    </span>
                  ) : null}
                  <Link
                    href={l.href}
                    className="rounded-lg px-1.5 py-1 font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <ThemeSwitcher />
        </div>
      </div>
      <div className="border-t border-zinc-200/60 dark:border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="font-medium">No servers. No accounts. No tracking.</p>
          <p>Runs entirely in your browser.</p>
        </div>
      </div>
    </footer>
  );
}
