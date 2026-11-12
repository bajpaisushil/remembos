"use client";

/**
 * Welcome tour, mounted once by the app shell (no props).
 *
 * It never opens by itself — a first visit lands straight on the upload area. It opens only when
 * something sets `onboardingOpen` (the Help page's "Show the welcome tour" buttons). The tour is
 * loaded on demand, so pages that never show it don't pay for it.
 */
import dynamic from "next/dynamic";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { onboardingOpen } from "@/lib/ui-state";

const OnboardingTour = dynamic(() => import("./OnboardingTour").then((m) => m.OnboardingTour), { ssr: false });

function closeTour(): void {
  onboardingOpen.set(false);
}

export function OnboardingDialog() {
  const open = useStore(onboardingOpen);
  // Keep the tour mounted after its first opening so it can animate out.
  const [loaded, setLoaded] = useState(false);
  if (open && !loaded) setLoaded(true);

  if (!loaded) return null;
  return <OnboardingTour open={open} onClose={closeTour} />;
}
