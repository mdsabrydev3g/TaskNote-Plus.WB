import { PRIORITY_META } from "@/lib/config";
import { cn } from "@/lib/utils";

export function PriorityChip({
  priority,
  isArabic = true,
  className,
}: {
  priority: keyof typeof PRIORITY_META;
  isArabic?: boolean;
  className?: string;
}) {
  const meta = PRIORITY_META[priority] ?? PRIORITY_META.medium;
  return (
    <span
      className={cn("chip", className)}
      style={{ backgroundColor: `${meta.color}14`, color: meta.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden />
      {isArabic ? meta.labelAr : meta.labelEn}
    </span>
  );
}
