"use client";

import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

/**
 * §4 Golden Rule / §8.8: anything irreversible or externally visible asks first.
 * This dialog is the single confirmation surface so the interaction is
 * consistent everywhere and impossible to forget in a new call site.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "تأكيد · Confirm",
  cancelLabel = "إلغاء · Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onCancel} aria-hidden />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-pop"
      >
        <div className="flex items-start gap-3">
          {tone === "danger" ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <AlertTriangle className="h-4.5 w-4.5" aria-hidden />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <h3 id="confirm-title" className="text-sm font-semibold text-ink">
              {title}
            </h3>
            {description ? (
              <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1 text-ink-faint transition-colors hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={tone === "danger" ? "btn bg-red-600 text-white hover:bg-red-700" : "btn-primary"}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
