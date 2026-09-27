import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Brain,
  Calendar,
  CheckSquare,
  Cloud,
  Folder,
  Inbox,
  Lock,
  NotebookPen,
  Shield,
  Sparkles,
  Target,
  WifiOff,
} from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { APP_NAME } from "@/lib/config";

export default async function LandingPage() {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-dvh bg-white">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white">
              TN
            </div>
            <span className="text-[15px] font-semibold tracking-tight text-ink">{APP_NAME}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost">
              دخول · Sign in
            </Link>
            <Link href="/register" className="btn-primary">
              ابدأ مجاناً · Start free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden px-5 py-20 lg:py-28">
        <div className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-brand-50/80 to-transparent" />
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-3.5 py-1.5 text-xs font-medium text-brand-700">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              يعمل على الموبايل كتطبيق · Installable on mobile
            </span>

            <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.15] tracking-tight text-ink lg:text-5xl">
              كل ما تفكر فيه
              <br />
              <span className="text-brand-600">وكل ما تعمل عليه</span>
              <br />
              في مساحة واحدة.
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-balance text-[15px] leading-relaxed text-ink-muted lg:text-base">
              ملاحظات، مهام، مشاريع، أهداف، وتقويم — في نظام واحد مترابط، مع مساعد ذكي
              يفهم سياقك الكامل، ويبقى تحت سيطرتك بالكامل. يعمل بدون إنترنت، ويتزامن
              بين كل أجهزتك.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/register" className="btn-primary px-6 py-3 text-[15px]">
                ابدأ الآن — مجاناً
                <ArrowRight className="h-4 w-4 flip-rtl" aria-hidden />
              </Link>
              <Link href="/login" className="btn-secondary px-6 py-3 text-[15px]">
                لدي حساب بالفعل
              </Link>
            </div>

            <p className="mt-4 text-xs text-ink-faint">
              بدون بطاقة بنكية · لا نبيع بياناتك · لا إعلانات، أبداً
            </p>
          </div>
        </div>
      </section>

      {/* Modules */}
      <section className="border-y border-slate-200 bg-slate-50/60 px-5 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-ink">
            نظام واحد، لا تطبيقات متفرقة
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-ink-muted">
            معظم الأدوات تفصلك: الملاحظات هنا، المهام هناك، التقويم في مكان ثالث.
            TaskNote Plus يبني نموذج بيانات واحد، فتستطيع العدّة أن تفهم كل شيء معاً.
          </p>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { Icon: Inbox, ar: "التقاط شامل", en: "Universal capture", descAr: "نص، صوت، صورة، مقتطف ويب — من أي مكان، في أقل من ثانيتين. يعمل بدون إنترنت.", descEn: "Text, voice, image, web clip — from anywhere, in under two seconds. Works offline." },
              { Icon: NotebookPen, ar: "ملاحظات ذكية", en: "Smart notes", descAr: "روابط ثنائية الاتجاه، بحث نصي ودلالي، وتلخيص تلقائي.", descEn: "Backlinks, lexical and semantic search, automatic summaries." },
              { Icon: CheckSquare, ar: "مهام قابلة للتنفيذ", en: "Actionable tasks", descAr: "لوحة ولوائح، مهام فرعية، تكرار، ووسوم الطاقة لتعمّق التركيز.", descEn: "Board and list views, subtasks, recurrence, and energy tags for deep work." },
              { Icon: Folder, ar: "مشاريع مترابطة", en: "Connected projects", descAr: "المهام والملاحظات والأهداف على خط زمني واحد، وتقدّم يُحسب تلقائياً.", descEn: "Tasks, notes and goals on one timeline, with progress computed automatically." },
              { Icon: Calendar, ar: "تقويم ميلادي وهجري", en: "Gregorian + Hijri", descAr: "مواعيد متكررة بمعيار RFC 5545، وواجهة عربية أصلية بالكامل.", descEn: "RFC 5545 recurrence, with a fully native Arabic interface." },
              { Icon: Target, ar: "أهداف وعادات", en: "Goals & habits", descAr: "تقدّم يُحسب من المهام المرتبطة، وسلاسل مع أيام سماح اختيارية.", descEn: "Progress computed from linked tasks, with optional grace days for streaks." },
              { Icon: Brain, ar: "مساعد يفهم سياقك", en: "Context-aware assistant", descAr: "إجابات مع مصادر ظاهرة. إذا لم يجد الإجابة، يقول ذلك بصراحة.", descEn: "Answers with visible sources. If it cannot find one, it says so plainly." },
              { Icon: WifiOff, ar: "يعمل بلا إنترنت", en: "Offline-first", descAr: "كل شيء يعمل بدون اتصال، ويتزامن تلقائياً عند العودة.", descEn: "Everything works without a connection, and syncs when you return." },
            ].map((item) => {
              const Icon = item.Icon;
              return (
                <article key={item.en} className="card p-5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <Icon className="h-4 w-4" aria-hidden />
                  </div>
                  <h3 className="mt-3.5 text-sm font-semibold text-ink">{item.ar}</h3>
                  <p className="mt-1 text-[11px] font-medium text-ink-faint">{item.en}</p>
                  <p className="mt-2 text-xs leading-relaxed text-ink-muted">{item.descAr}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="px-5 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-ink">
            خصوصيتك ليست ميزة إضافية — هي الأساس
          </h2>

          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {[
              { Icon: Lock, ar: "تُبقي السيطرة الكاملة", descAr: "المساعد لا يقرأ إلا ما تسمح به صراحة، ولا ينفّذ أي إجراء خارجي بدون موافقتك. كل إجراء له تراجع." },
              { Icon: Shield, ar: "بلا بوابات خلفية", descAr: "كل طلب مصادَق عليه، وكل وصول مربوط بحسابك. إعادة استخدام رمز مسروق تُلغي كل الجلسات تلقائياً." },
              { Icon: Cloud, ar: "لا بياناتك للبيع", descAr: "لا إعلانات، لا تتبّع، ولا مشاركة مع أي طرف ثالث. ولا خطة لضمها مستقبلاً." },
            ].map((item) => {
              const Icon = item.Icon;
              return (
                <article key={item.ar} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
                  <Icon className="h-5 w-5 text-brand-600" aria-hidden />
                  <h3 className="mt-4 text-sm font-semibold text-ink">{item.ar}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-ink-muted">{item.descAr}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-200 bg-gradient-to-br from-brand-600 to-indigo-800 px-5 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-white lg:text-3xl">
            ابدأ بلا شيء — فقط ما في رأسك الآن
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-brand-100">
            سجّل، والتقط أول فكرة خلال ثلاثين ثانية.
          </p>
          <Link
            href="/register"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-[15px] font-medium text-brand-700 shadow-lg transition-transform hover:scale-[1.02]"
          >
            أنشئ مساحتك
            <ArrowRight className="h-4 w-4 flip-rtl" aria-hidden />
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-200 px-5 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-xs text-ink-faint sm:flex-row">
          <span>{APP_NAME} · نظام تشغيل الإنتاجية الشخصية</span>
          <span>صُنع بعناية للمستخدم العربي أولاً</span>
        </div>
      </footer>
    </div>
  );
}
