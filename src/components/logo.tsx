import Image from "next/image";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/config";

/**
 * The TaskNote Plus mark — the illustrated task-list monitor supplied by the
 * user. Rendered from a background-trimmed PNG so the line art sits cleanly on
 * both the light and dark surfaces.
 */
export function LogoMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-muted",
        className,
      )}
      style={{ width: size * 1.28, height: size * 1.28 }}
    >
      <Image
        src="/icons/logo-transparent.png"
        alt=""
        width={size}
        height={size}
        className="object-contain"
        style={{ width: size, height: size }}
        priority
      />
    </span>
  );
}

/** Mark plus wordmark, for headers and auth screens. */
export function LogoLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight text-ink">{APP_NAME}</span>
    </span>
  );
}
