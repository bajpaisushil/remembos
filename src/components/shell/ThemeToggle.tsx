"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { Menu } from "@/components/ui/Menu";
import { Segmented } from "@/components/ui/Segmented";
import { updateSettings, useSettings } from "@/lib/settings";
import { useMounted } from "@/lib/hooks";
import type { ThemePreference } from "./theme";

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Header theme picker: icon button with a System / Light / Dark menu. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme } = useSettings();
  const mounted = useMounted();
  // Settings hydrate on the client; show the neutral icon until then to avoid a mismatch.
  const current = mounted ? theme : "system";
  const Icon = OPTIONS.find((o) => o.value === current)?.icon ?? Monitor;
  return (
    <Menu
      label={`Theme: ${OPTIONS.find((o) => o.value === current)?.label ?? "System"}`}
      icon={<Icon />}
      align="end"
      triggerClassName={className}
      data-testid="theme-toggle"
      items={OPTIONS.map((o) => ({
        label: o.label,
        icon: <o.icon />,
        checked: current === o.value,
        onSelect: () => updateSettings({ theme: o.value }),
        "data-testid": `theme-${o.value}`,
      }))}
    />
  );
}

/** Inline System / Light / Dark switcher (footer, settings). */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme } = useSettings();
  const mounted = useMounted();
  return (
    <Segmented<ThemePreference>
      aria-label="Color theme"
      size="sm"
      value={mounted ? theme : "system"}
      onChange={(value) => updateSettings({ theme: value })}
      options={OPTIONS.map((o) => ({ value: o.value, label: <span className="sr-only sm:not-sr-only">{o.label}</span>, icon: <o.icon /> }))}
      className={className}
      testIdPrefix="theme-switcher"
    />
  );
}
