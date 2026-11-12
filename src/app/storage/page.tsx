import type { Metadata } from "next";
import { StorageGuide } from "@/components/storage-guide/StorageGuide";

export const metadata: Metadata = {
  title: "Where your data lives",
  description:
    "Which browser storage Remembos uses for what — IndexedDB, Cache Storage, localStorage, sessionStorage, cookies — where it sits on your computer, a live inspector, and how not to erase it by accident.",
};

/** /storage/ — "Where your data lives". */
export default function StoragePage() {
  return <StorageGuide />;
}
