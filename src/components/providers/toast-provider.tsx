"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, Info, TriangleAlert, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info" | "warning";

type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
};

type ToastContextValue = {
  push: (toast: Omit<Toast, "id">) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_META: Record<ToastKind, { icon: typeof CheckCircle2; className: string }> = {
  success: { icon: CheckCircle2, className: "text-emerald-600" },
  error: { icon: XCircle, className: "text-red-600" },
  info: { icon: Info, className: "text-blue-600" },
  warning: { icon: TriangleAlert, className: "text-amber-600" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      // Errors stay long enough to read; the rest fade quickly.
      const ttl = toast.kind === "error" ? 7000 : 4000;
      window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description) => push({ kind: "success", title, description }),
      error: (title, description) => push({ kind: "error", title, description }),
      info: (title, description) => push({ kind: "info", title, description }),
      warning: (title, description) => push({ kind: "warning", title, description }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 z-[100] flex w-full flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const meta = KIND_META[toast.kind];
          const Icon = meta.icon;
          return (
            <div
              key={toast.id}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm animate-fade-in items-start gap-3",
                "rounded-2xl border border-slate-200 bg-white p-3.5 shadow-pop",
              )}
            >
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", meta.className)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{toast.description}</p>
                ) : null}
                {toast.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action?.onClick();
                      dismiss(toast.id);
                    }}
                    className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700"
                  >
                    {toast.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded-lg p-1 text-ink-faint transition-colors hover:bg-slate-100 hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
