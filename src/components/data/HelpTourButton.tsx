"use client";

import { Play } from "lucide-react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { onboardingOpen } from "@/lib/ui-state";

export interface HelpTourButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  label?: string;
  "data-testid"?: string;
}

/** Opens the welcome tour (Help page) — the only way it appears; it never opens by itself. */
export function HelpTourButton({ variant = "primary", size = "md", label = "Show the welcome tour", "data-testid": testId }: HelpTourButtonProps) {
  return (
    <Button variant={variant} size={size} leftIcon={<Play />} onClick={() => onboardingOpen.set(true)} data-testid={testId}>
      {label}
    </Button>
  );
}
