import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AuthForm } from "@/components/auth-form";
import { LogoLockup } from "@/components/logo";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Form column */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-10 inline-flex items-center gap-2.5">
            <LogoLockup />
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            أهلاً بعودتك
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">Welcome back — sign in to your workspace.</p>

          <div className="mt-8">
            <AuthForm mode="login" />
          </div>

          <p className="mt-6 text-center text-sm text-ink-muted">
            ليس لديك حساب؟{" "}
            <Link href="/register" className="font-medium text-brand-600 hover:text-brand-700">
              أنشئ حساباً · Sign up
            </Link>
          </p>
        </div>
      </div>

      {/* Brand column */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-indigo-900 lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div className="absolute -end-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="absolute -bottom-32 -start-16 h-80 w-80 rounded-full bg-accent-400/20 blur-3xl" aria-hidden />

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-snug text-white">
            كل ما تفكر فيه
            <br />
            وكل ما تعمل عليه
            <br />
            <span className="text-brand-200">في مساحة واحدة.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-brand-100">
            ملاحظات، مهام، مشاريع، أهداف، وتقويم — مرتبطون ببعض بمساعد ذكي يفهم سياقك،
            وبياناتك تبقى ملكك وحدك.
          </p>

          <ul className="mt-10 space-y-3.5">
            {[
              "التقاط فوري لأي شيء — نص، صوت، صورة، أو مقتطف",
              "مساعد ذكي مقيد بصلاحياتك، وكل إجراء قابل للتراجع",
              "يعمل بدون إنترنت، ويتزامن تلقائياً عند العودة",
              "واجهة عربية أصلية بدعم كامل لليمين-لليسار والتقويم الهجري",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3 text-sm text-brand-50">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-300" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
