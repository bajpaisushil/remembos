import type { Metadata } from "next";
import { DataScreen } from "@/components/data/DataScreen";

export const metadata: Metadata = {
  title: "Your data",
  description:
    "See how much space your memories use, keep them safe with a backup, manage the on-device AI models and settings, or start over — everything stays in this browser.",
};

export default function DataPage() {
  return <DataScreen />;
}
