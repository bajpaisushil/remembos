// Cross-component UI state (no persistence). Any component may open these.
import { createStore } from "./store";

/** ⌘K command palette open/closed. Owned/rendered by components/search/CommandPalette. */
export const paletteOpen = createStore<boolean>(false);

/** Quick-add composer (write a note / paste text). Rendered by components/ingest/QuickAddDialog. */
export const quickAdd = createStore<null | { mode: "note" | "text"; initialText?: string }>(null);

/** Welcome tour visibility. Never auto-opens (first visit lands straight on the upload area); Help page can open it. */
export const onboardingOpen = createStore<boolean>(false);

/** True while the user drags files over the window (GlobalDropOverlay sets it; DropZone animates from it). */
export const dragActive = createStore<boolean>(false);

/** Ask any file picker to open (e.g. a tool tile requesting a specific kind). GlobalDropOverlay owns the picker. */
export const filePickerRequest = createStore<null | { accept: string; nonce: number; capture?: "environment" | "user" }>(null);

/** Mobile "add" bottom sheet (opened by the centre + in the tab bar). Rendered by components/shell/AddSheet. */
export const addSheetOpen = createStore<boolean>(false);

/** In-app voice recorder dialog. Rendered by components/ingest/VoiceRecorderDialog. */
export const recorderOpen = createStore<boolean>(false);

/** "How to install" instructions sheet (iOS Add to Home Screen, or browsers without a prompt). Rendered by the shell. */
export const installHelpOpen = createStore<boolean>(false);

/** "Use Remembos offline" steps dialog. Rendered by components/shell/OfflineSetup (via LazyMounts). */
export const offlineSetupOpen = createStore<boolean>(false);
