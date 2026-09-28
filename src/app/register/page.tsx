import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AuthForm } from "@/components/auth-form";
import { LogoLockup } from "@/components/logo";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-10 inline-flex items-center gap-2.5">
          <LogoLockup />
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight text-ink">أنشئ مساحتك</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Create your workspace — you&apos;ll be capturing something within 30 seconds.
        </p>

        <div className="mt-8">
          <AuthForm mode="register" />
        </div>

        <p className="mt-6 text-center text-sm text-ink-muted">
          لديك حساب بالفعل؟{" "}
          <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
            سجّل الدخول · Sign in
          </Link>
        </p>

        <p className="mt-8 text-center text-[11px] leading-relaxed text-ink-faint">
          بالمتابعة أنت توافق على شروط الاستخدام وسياسة الخصوصية.
          <br />
          بياناتك مشفّرة أثناء النقل والسكون، ولا تُشارك مع أي طرف ثالث.
        </p>
      </div>
    </div>
  );
}
