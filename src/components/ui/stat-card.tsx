import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "warning" | "danger" | "success" | "brand";
  icon?: React.ReactNode;
}) {
  const tones = {
    default: "text-ink",
    brand: "text-brand-600",
    success: "text-emerald-600",
    warning: "text-amber-600",
    danger: "text-red-600",
  } as const;

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        {icon ? <span className="text-ink-faint">{icon}</span> : null}
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", tones[tone])}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p> : null}
    </div>
  );
}
