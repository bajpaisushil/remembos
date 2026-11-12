// Primary navigation shared by the header and the mobile tab bar.
import { CircleHelp, HardDrive, House, LibraryBig, Search, Waypoints, type LucideIcon } from "lucide-react";
import { ROUTES } from "@/lib/config";

export interface NavItem {
  href: string;
  label: string;
  /** Shorter label for tight spaces (tab bar, medium screens). */
  short: string;
  icon: LucideIcon;
  /** Other routes that should highlight this item. */
  also?: string[];
  /** Shown in the mobile bottom tab bar (four tabs around the centre + button). */
  mobile: boolean;
  testId: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: ROUTES.home, label: "Home", short: "Home", icon: House, mobile: true, testId: "nav-home" },
  { href: ROUTES.search, label: "Search", short: "Search", icon: Search, mobile: true, testId: "nav-search" },
  { href: ROUTES.library, label: "Library", short: "Library", icon: LibraryBig, also: [ROUTES.item], mobile: true, testId: "nav-library" },
  // The tab bar's middle slot is the + (add) button; Graph stays one tap away from Home, Library and the desktop nav.
  { href: ROUTES.graph, label: "Graph", short: "Graph", icon: Waypoints, mobile: false, testId: "nav-graph" },
  { href: ROUTES.data, label: "Your data", short: "Data", icon: HardDrive, also: [ROUTES.storage], mobile: true, testId: "nav-data" },
  { href: ROUTES.help, label: "Help", short: "Help", icon: CircleHelp, mobile: false, testId: "nav-help" },
];

function normalize(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** Whether `item` is the current section for `pathname` (as returned by usePathname, without base path). */
export function isNavActive(item: NavItem, pathname: string | null): boolean {
  if (!pathname) return false;
  const current = normalize(pathname);
  const targets = [item.href, ...(item.also ?? [])].map(normalize);
  return targets.some((t) => (t === "/" ? current === "/" : current === t || current.startsWith(`${t}/`)));
}
