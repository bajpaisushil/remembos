"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { copyToClipboard, truncate } from "@/lib/utils";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";

export interface CopyButtonProps {
  /** Text to copy (or a function producing it at click time). */
  value: string | (() => string);
  /** Visible label (default "Copy"). */
  label?: string;
  copiedLabel?: string;
  /** Icon-only button; `label` becomes the aria-label. */
  iconOnly?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Also show a small "Copied" toast. Default true. */
  notify?: boolean;
  className?: string;
  "data-testid"?: string;
}

/** Copies text to the clipboard with a check-mark confirmation. */
export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  iconOnly = false,
  variant = "ghost",
  size,
  notify = true,
  className,
  "data-testid": testId,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function onCopy() {
    const text = typeof value === "function" ? value() : value;
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      if (notify) toast.success("Copied to clipboard", { id: "copied", description: truncate(text.replace(/\s+/g, " "), 80), duration: 1800 });
    } else {
      toast.error("Couldn't copy", { id: "copied", description: "Your browser blocked clipboard access. Select the text and copy it instead." });
    }
  }

  const icon = copied ? <Check className="text-emerald-500" /> : <Copy />;
  return (
    <Button
      variant={variant}
      size={size ?? (iconOnly ? "icon-sm" : "sm")}
      onClick={onCopy}
      aria-label={iconOnly ? (copied ? copiedLabel : label) : undefined}
      leftIcon={iconOnly ? undefined : icon}
      className={className}
      data-testid={testId}
    >
      {iconOnly ? icon : copied ? copiedLabel : label}
      <span aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </Button>
  );
}
