"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { undoAiAction as undoAiActionAction } from "@/app/actions/tasks-bridge";
import { useToast } from "@/components/providers/toast-provider";

export function UndoAiAction({
  aiLogId,
  label,
  icon,
}: {
  aiLogId: string;
  label: string;
  icon?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const undo = () => {
    startTransition(async () => {
      const result = await undoAiActionAction(aiLogId);
      if (result.ok) {
        toast.success("تم التراجع", "The action was undone");
        router.refresh();
      } else {
        toast.error("تعذّر التراجع", result.error);
      }
    });
  };

  return (
    <button type="button" onClick={undo} disabled={isPending} className="btn-secondary text-[11px]">
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
      {label}
    </button>
  );
}
