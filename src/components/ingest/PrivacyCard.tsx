import { ArrowRight, LifeBuoy, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Accent } from "@/components/ui/PageHeader";
import { ROUTES } from "@/lib/config";

/** Slim privacy promise at the bottom of home, linking to "Where your data lives" and Help. Static. */
export function PrivacyCard() {
  return (
    <section
      aria-labelledby="privacy-title"
      data-testid="privacy-card"
      className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-white/80 p-5 shadow-soft sm:p-6 dark:border-emerald-400/15 dark:bg-white/[0.04]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_90%_at_0%_0%,rgb(16_185_129/0.10),transparent_70%),radial-gradient(40%_80%_at_100%_100%,rgb(139_92_246/0.08),transparent_70%)] dark:bg-[radial-gradient(45%_90%_at_0%_0%,rgb(16_185_129/0.16),transparent_70%),radial-gradient(40%_80%_at_100%_100%,rgb(139_92_246/0.14),transparent_70%)]"
      />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="inline-grid size-11 shrink-0 place-items-center rounded-2xl bg-emerald-500 text-white shadow-[0_10px_24px_-10px_rgb(16_185_129/0.8)]">
            <ShieldCheck aria-hidden className="size-[22px]" />
          </span>
          <div className="min-w-0">
            <h2 id="privacy-title" className="text-lg font-semibold tracking-tight text-zinc-900 sm:text-xl dark:text-white">
              Your memories never <Accent>leave</Accent> this device.
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              No account, no uploads, no tracking. Reading, transcribing and search run in your browser, and files stay
              in its normal website storage — nowhere else.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row md:shrink-0">
          <Button href={ROUTES.storage} variant="secondary" rightIcon={<ArrowRight />} data-testid="privacy-storage-link">
            Where your data lives
          </Button>
          <Button href={ROUTES.help} variant="ghost" leftIcon={<LifeBuoy />}>
            Help &amp; tips
          </Button>
        </div>
      </div>
    </section>
  );
}
