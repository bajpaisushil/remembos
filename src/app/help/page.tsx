import type { Metadata } from "next";
import { HelpScreen } from "@/components/data/HelpScreen";

export const metadata: Metadata = {
  title: "Help",
  description:
    "How Remembos works, what you can drop in, how to ask questions, keyboard shortcuts, and straight answers about privacy, offline use, storage and backups.",
};

export default function HelpPage() {
  return <HelpScreen />;
}
