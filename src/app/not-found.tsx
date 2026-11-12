import { CircleHelp, House, LibraryBig, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Accent, Container } from "@/components/ui/PageHeader";
import { ROUTES } from "@/lib/config";

export const metadata: Metadata = {
  title: "Page not found",
};

const SUGGESTIONS = [
  { href: ROUTES.search, label: "Search your memories", hint: "Find anything by words or meaning", icon: Search },
  { href: ROUTES.library, label: "Browse the library", hint: "Everything you've saved, newest first", icon: LibraryBig },
  { href: ROUTES.help, label: "Get help", hint: "How Remembos works and where data lives", icon: CircleHelp },
];

/** Friendly 404. */
export default function NotFound() {
  return (
    <Container size="sm" className="flex flex-col items-center py-16 text-center sm:py-24">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 scale-150 rounded-full bg-linear-to-br from-indigo-400/30 via-violet-400/25 to-fuchsia-400/30 blur-3xl"
        />
        <p className="pr-[0.1em] font-serif text-[7rem] leading-none italic text-gradient sm:text-[9rem]">404</p>
      </div>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-white">
        This page <Accent>slipped</Accent> our mind
      </h1>
      <p className="mt-3 max-w-md text-base leading-relaxed text-muted">
        The link may be old or mistyped. Don&apos;t worry — your memories are safe right where they were, in this browser.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-2.5">
        <Button href={ROUTES.home} size="lg" leftIcon={<House />}>
          Back to home
        </Button>
      </div>

      <ul className="mt-12 grid w-full gap-3 text-left sm:grid-cols-3">
        {SUGGESTIONS.map(({ href, label, hint, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="group flex h-full flex-col gap-2 rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-soft transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-zinc-300/80 hover:shadow-lift dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:bg-brand-400/15 dark:text-brand-300">
                <Icon aria-hidden className="size-[18px]" />
              </span>
              <span className="text-sm font-semibold text-zinc-900 dark:text-white">{label}</span>
              <span className="text-[13px] leading-snug text-muted">{hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
