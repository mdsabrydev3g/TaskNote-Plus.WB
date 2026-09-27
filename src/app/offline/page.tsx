import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-ink-muted">
        <WifiOff className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink">
        أنت غير متصل
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
        TaskNote Plus يعمل بدون إنترنت — لكن هذه الصفحة لم تُخزَّن بعد على جهازك.
        <br />
        <span className="text-xs">
          TaskNote Plus works offline, but this page was not cached on your device yet.
        </span>
      </p>
      <Link href="/dashboard" className="btn-primary mt-6">
        العودة للوحة اليوم · Back to Today
      </Link>
    </div>
  );
}
