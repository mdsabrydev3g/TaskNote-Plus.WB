"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { loginAction, registerAction, type ActionState } from "@/app/actions/auth";
import { useToast } from "@/components/providers/toast-provider";
import { cn } from "@/lib/utils";

const initialState: ActionState = { ok: false };

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const toast = useToast();
  const action = mode === "login" ? loginAction : registerAction;
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (state?.ok) {
      toast.success(mode === "login" ? "تم تسجيل الدخول" : "تم إنشاء الحساب");
      router.push("/dashboard");
      router.refresh();
    }
  }, [state, router, toast, mode]);

  // Live password strength feedback on sign-up — guided, not punitive.
  const checks = [
    { label: "10+ characters", pass: password.length >= 10 },
    { label: "Upper & lowercase", pass: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { label: "A number", pass: /\d/.test(password) },
  ];
  const passed = checks.filter((c) => c.pass).length;

  return (
    <form action={formAction} className="space-y-4">
      {mode === "register" ? (
        <div>
          <label htmlFor="displayName" className="label">
            الاسم · Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            autoComplete="name"
            required
            className={cn("input", state?.field === "displayName" && "border-red-300")}
            placeholder="محمد / Mohammed"
          />
        </div>
      ) : null}

      <div>
        <label htmlFor="email" className="label">
          البريد الإلكتروني · Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          dir="ltr"
          className={cn("input text-start", state?.field === "email" && "border-red-300")}
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="label">
          كلمة المرور · Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={cn("input pe-11 text-start", state?.field === "password" && "border-red-300")}
            placeholder="••••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute end-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-ink-faint transition-colors hover:text-ink"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {mode === "register" && password.length > 0 ? (
          <div className="mt-2.5 space-y-1.5">
            <div className="flex gap-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors",
                    i < passed
                      ? passed === 3
                        ? "bg-emerald-500"
                        : passed === 2
                          ? "bg-amber-500"
                          : "bg-red-400"
                      : "bg-slate-200",
                  )}
                />
              ))}
            </div>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {checks.map((c) => (
                <li
                  key={c.label}
                  className={cn("text-[11px]", c.pass ? "text-emerald-600" : "text-ink-faint")}
                >
                  {c.pass ? "✓" : "○"} {c.label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {state?.error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={isPending} className="btn-primary w-full py-2.5">
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {mode === "login" ? "تسجيل الدخول · Sign in" : "إنشاء الحساب · Create account"}
      </button>

      {mode === "login" ? (
        <p className="text-center text-xs text-ink-faint">
          نسيت كلمة المرور؟{" "}
          <Link href="/forgot-password" className="text-brand-600 hover:text-brand-700">
            استعدها
          </Link>
        </p>
      ) : null}
    </form>
  );
}
