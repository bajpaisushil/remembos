import { Accent } from "@/components/ui/PageHeader";

/**
 * Home headline: one short promise and one line on what to add. Rendered statically (no client code) so it
 * paints with the first HTML; the upload panel sits right below it. Search lives in the header and /search/.
 */
export function HomeHero() {
  return (
    <section aria-labelledby="home-title" className="relative isolate pt-7 pb-5 text-center sm:pt-12 sm:pb-8">
      {/* Extra glow behind the hero, on top of the app-wide backdrop. Static gradients only. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-16 -z-10 h-[30rem]">
        <div className="absolute top-0 left-[8%] h-72 w-[45%] rounded-full bg-[radial-gradient(closest-side,rgb(99_102_241/0.14),transparent)] dark:bg-[radial-gradient(closest-side,rgb(99_102_241/0.22),transparent)]" />
        <div className="absolute top-6 right-[6%] h-64 w-[42%] rounded-full bg-[radial-gradient(closest-side,rgb(217_70_239/0.11),transparent)] dark:bg-[radial-gradient(closest-side,rgb(217_70_239/0.18),transparent)]" />
        <div className="absolute top-24 left-1/2 h-72 w-[min(52rem,100%)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(139_92_246/0.14),transparent)] dark:bg-[radial-gradient(closest-side,rgb(139_92_246/0.26),transparent)]" />
      </div>

      <h1
        id="home-title"
        className="mx-auto max-w-3xl text-[2.15rem] leading-[1.06] font-semibold tracking-tight text-balance text-zinc-900 min-[400px]:text-[2.5rem] sm:text-5xl lg:text-[3.6rem] dark:text-white"
      >
        Remember <Accent>everything</Accent> you see.
      </h1>

      <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-pretty text-muted sm:mt-4 sm:text-lg">
        Drop screenshots, PDFs, videos, voice notes or text — read on your device, found in seconds.
      </p>
    </section>
  );
}
