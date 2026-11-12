"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { installHelpOpen } from "@/lib/ui-state";

// The instructions are only needed when someone asks how to install, so they load on first use.
const InstallHelpSheet = dynamic(() => import("./InstallHelpSheet").then((m) => m.InstallHelpSheet), { ssr: false });

/** "How to install" sheet (driven by `installHelpOpen`). Mounted globally by the app shell. No props. */
export function InstallHelpDialog() {
  const open = useStore(installHelpOpen);
  const [wanted, setWanted] = useState(false);
  if (open && !wanted) setWanted(true);
  return wanted ? <InstallHelpSheet /> : null;
}
