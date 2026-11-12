"use client";

/**
 * "Install as an app" — the Data page card, plus the install button set reused by the Help page
 * and the storage guide. The shell captures the browser's install prompt (src/lib/pwa); this only
 * reads `installState` and calls `promptInstall()`, or opens the how-to sheet (`installHelpOpen`)
 * on iPhone/iPad and in browsers without a prompt.
 */
import { Check, MonitorDown, Smartphone } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { installState, promptInstall } from "@/lib/pwa";
import { useStore } from "@/lib/store";
import { installHelpOpen } from "@/lib/ui-state";
import { cn } from "@/lib/utils";
import { InstallBenefits } from "./install-content";
import { Panel } from "./shared";

export interface InstallActionsProps {
  size?: ButtonSize;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  className?: string;
  /** Prefix for data-testid ("install" → install-button / install-status / install-howto). */
  testIdPrefix?: string;
}

/** Install button (or "How to install" / "Installed ✓"), depending on what this browser allows. */
export function InstallActions({ size = "md", variant = "primary", fullWidth, className, testIdPrefix = "install" }: InstallActionsProps) {
  const { canInstall, installed, platform } = useStore(installState);
  const [busy, setBusy] = useState(false);

  if (installed) {
    return (
      <Badge tone="success" icon={<Check />} className={cn(size === "lg" ? "h-8 px-3 text-sm" : null, className)} data-testid={`${testIdPrefix}-status`} data-state="installed">
        Installed ✓
      </Badge>
    );
  }

  if (canInstall) {
    return (
      <Button
        size={size}
        variant={variant}
        fullWidth={fullWidth}
        className={className}
        leftIcon={<MonitorDown />}
        loading={busy}
        data-testid={`${testIdPrefix}-button`}
        onClick={async () => {
          setBusy(true);
          try {
            const accepted = await promptInstall();
            if (!accepted && installState.get().platform === "ios") installHelpOpen.set(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        Install Remembos
      </Button>
    );
  }

  return (
    <Button
      size={size}
      variant={variant === "primary" ? "secondary" : variant}
      fullWidth={fullWidth}
      className={className}
      leftIcon={platform === "ios" ? <Smartphone /> : <MonitorDown />}
      data-testid={`${testIdPrefix}-howto`}
      onClick={() => installHelpOpen.set(true)}
    >
      {platform === "ios" ? "Add to Home Screen" : "How to install"}
    </Button>
  );
}

/** The Data page's "Install as an app" card. */
export function InstallAppCard() {
  const { installed } = useStore(installState);
  return (
    <Panel
      id="install"
      icon={<MonitorDown />}
      title="Install as an app"
      description={
        installed
          ? "You're using Remembos as an installed app — everything below is already yours."
          : "Free and instant — no app store. Your memories stay exactly where they are."
      }
      actions={<InstallActions testIdPrefix="install" />}
      data-testid="install-card"
    >
      <InstallBenefits />
      {!installed ? (
        <p className="mt-4 text-[13px] leading-relaxed text-muted">
          On iPhone and iPad: open Remembos in Safari, tap Share → <span className="font-medium text-zinc-700 dark:text-zinc-200">Add to Home Screen</span>.
          There, the installed app keeps its own storage — move memories over with a backup and restore.
        </p>
      ) : null}
    </Panel>
  );
}
