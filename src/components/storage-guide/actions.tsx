"use client";

import { Download, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { requestPersistence } from "@/lib/storage/monitor";
import { refreshInspection } from "./use-inspection";

/** Download a full backup (the backup module shows progress and result toasts). */
export async function startBackup(): Promise<void> {
  try {
    const { downloadBackup } = await import("@/lib/storage/backup");
    await downloadBackup();
  } catch (err) {
    console.warn("[remembos] backup could not start", err);
  } finally {
    void refreshInspection();
  }
}

/** Ask the browser to keep our data (monitor shows the result toast), then refresh the page's numbers. */
export async function askToKeep(): Promise<boolean> {
  try {
    return await requestPersistence();
  } finally {
    void refreshInspection();
  }
}

interface ActionButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
  label?: string;
  "data-testid"?: string;
}

/** "Back up now" — builds and downloads one file with everything. */
export function BackupButton({ variant = "primary", size = "md", fullWidth, className, label = "Back up now", "data-testid": testId }: ActionButtonProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      className={className}
      loading={busy}
      leftIcon={<Download />}
      data-testid={testId}
      onClick={async () => {
        setBusy(true);
        try {
          await startBackup();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Preparing backup…" : label}
    </Button>
  );
}

/** "Ask browser to keep my data" — requests persistent storage. */
export function KeepDataButton({
  variant = "secondary",
  size = "md",
  fullWidth,
  className,
  label = "Ask browser to keep my data",
  disabled,
  "data-testid": testId,
}: ActionButtonProps & { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      className={className}
      loading={busy}
      disabled={disabled}
      leftIcon={<ShieldCheck />}
      data-testid={testId}
      onClick={async () => {
        setBusy(true);
        try {
          await askToKeep();
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}
