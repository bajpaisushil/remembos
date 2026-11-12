"use client";

import { useSyncExternalStore } from "react";
import { Toaster as Sonner } from "sonner";
import { openModalCount } from "@/components/ui/internal";
import { useSettings } from "@/lib/settings";
import { useStore } from "@/lib/store";

/** Phones, where dialogs open as bottom sheets (matches the Dialog's `sm` breakpoint). */
const PHONE_QUERY = "(max-width: 639.98px)";

function subscribePhone(onChange: () => void): () => void {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

/**
 * Global toast host (sonner). Follows the app theme, uses rich colors and a close button,
 * stacks and expands on hover, and sits above the mobile tab bar (offset via --toast-offset-bottom).
 * On phones, while a dialog is open as a bottom sheet, toasts move to the top of the screen so they never
 * cover the sheet's buttons.
 * Show toasts anywhere with `import { toast } from "sonner"`.
 */
export function Toaster() {
  const { theme } = useSettings();
  const modalOpen = useStore(openModalCount) > 0;
  const phone = useIsPhone();
  const onTop = modalOpen && phone;
  return (
    <Sonner
      theme={theme}
      position={onTop ? "top-center" : "bottom-right"}
      richColors
      closeButton
      visibleToasts={4}
      gap={10}
      duration={5000}
      offset={{ bottom: "var(--toast-offset-bottom)", right: 20 }}
      mobileOffset={
        onTop
          ? { top: "calc(env(safe-area-inset-top, 0px) + 12px)", left: 12, right: 12 }
          : { bottom: "var(--toast-offset-bottom)", left: 12, right: 12 }
      }
      containerAriaLabel="Notifications"
    />
  );
}
