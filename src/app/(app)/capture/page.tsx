import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { CaptureWorkspace } from "@/components/capture-workspace";

export const metadata: Metadata = { title: "Capture" };

export default async function CapturePage() {
  const user = await requireUser();

  return <CaptureWorkspace isArabic={user.locale === "ar"} />;
}
