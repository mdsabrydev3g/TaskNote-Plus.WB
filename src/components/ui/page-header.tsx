import Link from "next/link";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4 pb-6", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function SectionHeading({
  title,
  action,
  href,
  actionLabel,
}: {
  title: string;
  action?: React.ReactNode;
  href?: string;
  actionLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
      {action ??
        (href && actionLabel ? (
          <Link href={href} className="text-xs font-medium text-brand-600 hover:text-brand-700">
            {actionLabel}
          </Link>
        ) : null)}
    </div>
  );
}
