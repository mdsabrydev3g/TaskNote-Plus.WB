"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Brain,
  Check,
  KeyRound,
  Loader2,
  Monitor,
  Palette,
  Shield,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { updateProfileAction, changePasswordAction, revokeDeviceAction } from "@/app/actions/auth";
import { savePermissions } from "@/app/actions/tasks-bridge";
import { useToast } from "@/components/providers/toast-provider";
import { useTheme } from "@/components/providers/theme-provider";
import { PageHeader } from "@/components/ui";
import { SCOPE_AREAS, ALL_SCOPES } from "@/lib/ai/scopes";
import { cn, formatRelativeTime } from "@/lib/utils";

type Tab = "profile" | "appearance" | "ai" | "security";

export function SettingsView({
  isArabic,
  profile,
  devices,
  aiStatus,
  granted,
}: {
  isArabic: boolean;
  profile: {
    displayName: string;
    email: string;
    locale: string;
    timezone: string;
    calendarSystem: string;
    weekStartsOn: number;
    theme: string;
  };
  devices: Array<{ id: string; name: string; platform: string; lastSeenAt: string; isCurrent: boolean }>;
  aiStatus: {
    available: boolean;
    provider: string;
    model: string;
    label: string;
    chain?: string[];
    providerCount?: number;
  };
  /** Scope keys the server currently has granted for this user. */
  granted: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<Tab>("profile");
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [locale, setLocale] = useState(profile.locale);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [calendarSystem, setCalendarSystem] = useState(profile.calendarSystem);
  const [weekStartsOn, setWeekStartsOn] = useState(String(profile.weekStartsOn));
  // Draft permissions, saved explicitly with the Save button below.
  const [draftScopes, setDraftScopes] = useState<Set<string>>(new Set(granted));
  const [savedScopes, setSavedScopes] = useState<Set<string>>(new Set(granted));
  const [permissionsDirty, setPermissionsDirty] = useState(false);
  const [isSaving, startSaveTransition] = useTransition();
  const [isSavingPermissions, startPermissionsTransition] = useTransition();
  const [busyDevice, setBusyDevice] = useState<string | null>(null);

  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const toggleDraft = (scope: string) => {
    setDraftScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
    setPermissionsDirty(true);
  };

  /** Turn a whole area on/off in one click. */
  const toggleArea = (area: string) => {
    const areaScopes = ALL_SCOPES.filter((s) => s.area === area).map((s) => s.scope);
    if (area === "notes") areaScopes.push("memory:write");
    setDraftScopes((prev) => {
      const next = new Set(prev);
      const allOn = areaScopes.every((s) => next.has(s));
      areaScopes.forEach((s) => (allOn ? next.delete(s) : next.add(s)));
      return next;
    });
    setPermissionsDirty(true);
  };

  const savePermissionsNow = () => {
    startPermissionsTransition(async () => {
      const result = await savePermissions([...draftScopes]);
      if (result.ok) {
        setSavedScopes(new Set(draftScopes));
        setPermissionsDirty(false);
        toast.success(
          t("حُفظت صلاحيات المساعد", "Assistant permissions saved"),
          t("سيُطبَّق ذلك على كل محادثة جديدة.", "Applies to every new conversation."),
        );
      } else {
        toast.error(t("تعذّر الحفظ", "Could not save"), result.error);
      }
    });
  };

  const saveProfile = () => {
    startSaveTransition(async () => {
      const formData = new FormData();
      formData.set("displayName", displayName);
      formData.set("locale", locale);
      formData.set("timezone", timezone);
      formData.set("calendarSystem", calendarSystem);
      formData.set("weekStartsOn", weekStartsOn);

      const result = await updateProfileAction(undefined, formData);
      if (result.ok) {
        toast.success(t("حُفظت التفضيلات", "Preferences saved"));
        router.refresh();
      } else {
        toast.error(t("تعذّر الحفظ", "Could not save"), result.error);
      }
    });
  };

  const revokeDevice = (deviceId: string) => {
    setBusyDevice(deviceId);
    startSaveTransition(async () => {
      const result = await revokeDeviceAction(deviceId);
      setBusyDevice(null);
      if (result.ok) {
        toast.success(t("تم تسجيل الخروج من الجهاز", "Signed out of that device"));
        router.refresh();
      } else {
        toast.error(t("تعذّر التنفيذ", "Could not complete that"), result.error);
      }
    });
  };

  const tabs: Array<{ key: Tab; ar: string; en: string; Icon: typeof User }> = [
    { key: "profile", ar: "الملف الشخصي", en: "Profile", Icon: User },
    { key: "appearance", ar: "المظهر واللغة", en: "Appearance", Icon: Palette },
    { key: "ai", ar: "المساعد والصلاحيات", en: "Assistant & permissions", Icon: Brain },
    { key: "security", ar: "الأمان والأجهزة", en: "Security & devices", Icon: Shield },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 lg:px-8 lg:py-8">
      <PageHeader title={t("الإعدادات", "Settings")} />

      <div className="mb-6 flex gap-1 overflow-x-auto scrollbar-thin border-b border-slate-200">
        {tabs.map(({ key, ar, en, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-medium transition-colors",
              tab === key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {t(ar, en)}
          </button>
        ))}
      </div>

      {tab === "profile" ? (
        <section className="card space-y-4 p-5">
          <div>
            <label htmlFor="display-name" className="label">
              {t("الاسم", "Display name")}
            </label>
            <input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="input"
            />
          </div>

          <div>
            <label htmlFor="email-readonly" className="label">
              {t("البريد الإلكتروني", "Email")}
            </label>
            <input id="email-readonly" value={profile.email} readOnly disabled className="input bg-slate-50 text-ink-faint" />
            <p className="mt-1.5 text-[11px] text-ink-faint">
              {t("لا يمكن تغييره حالياً.", "Cannot be changed right now.")}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="timezone" className="label">
                {t("المنطقة الزمنية", "Timezone")}
              </label>
              <input
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="input"
                placeholder="Asia/Riyadh"
                dir="ltr"
              />
            </div>
            <div>
              <label htmlFor="week-start" className="label">
                {t("يبدأ الأسبوع", "Week starts on")}
              </label>
              <select
                id="week-start"
                value={weekStartsOn}
                onChange={(e) => setWeekStartsOn(e.target.value)}
                className="input"
              >
                <option value="6">{t("السبت", "Saturday")}</option>
                <option value="0">{t("الأحد", "Sunday")}</option>
                <option value="1">{t("الاثنين", "Monday")}</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={saveProfile} disabled={isSaving} className="btn-primary">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              {t("حفظ", "Save")}
            </button>
          </div>
        </section>
      ) : null}

      {tab === "appearance" ? (
        <section className="space-y-5">
          <div className="card p-5">
            <h2 className="mb-3 text-xs font-semibold text-ink">{t("المظهر", "Theme")}</h2>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: "light", ar: "فاتح", en: "Light" },
                  { key: "dark", ar: "داكن", en: "Dark" },
                  { key: "system", ar: "حسب النظام", en: "System" },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTheme(option.key)}
                  aria-pressed={theme === option.key}
                  className={cn(
                    "rounded-xl border px-3 py-3 text-xs font-medium transition-colors",
                    theme === option.key
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-slate-200 text-ink-soft hover:border-slate-300",
                  )}
                >
                  {t(option.ar, option.en)}
                </button>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="mb-3 text-xs font-semibold text-ink">{t("اللغة والاتجاه", "Language & direction")}</h2>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { key: "ar", label: "العربية (RTL)" },
                  { key: "en", label: "English (LTR)" },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setLocale(option.key)}
                  aria-pressed={locale === option.key}
                  className={cn(
                    "rounded-xl border px-3 py-3 text-xs font-medium transition-colors",
                    locale === option.key
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-slate-200 text-ink-soft hover:border-slate-300",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              {t(
                "التغيير يُطبَّق بعد الحفظ وإعادة تحميل الصفحة.",
                "The change applies after saving and reloading the page.",
              )}
            </p>
          </div>

          <div className="card p-5">
            <h2 className="mb-3 text-xs font-semibold text-ink">{t("نظام التقويم", "Calendar system")}</h2>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: "gregorian", ar: "ميلادي", en: "Gregorian" },
                  { key: "hijri", ar: "هجري", en: "Hijri" },
                  { key: "both", ar: "كلاهما", en: "Both" },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setCalendarSystem(option.key)}
                  aria-pressed={calendarSystem === option.key}
                  className={cn(
                    "rounded-xl border px-3 py-3 text-xs font-medium transition-colors",
                    calendarSystem === option.key
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-slate-200 text-ink-soft hover:border-slate-300",
                  )}
                >
                  {t(option.ar, option.en)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={saveProfile} disabled={isSaving} className="btn-primary">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              {t("حفظ التفضيلات", "Save preferences")}
            </button>
          </div>
        </section>
      ) : null}

      {tab === "ai" ? (
        <section className="space-y-5">
          <div className="card p-5">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                  aiStatus.available ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-ink-faint",
                )}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xs font-semibold text-ink">
                  {aiStatus.available
                    ? t(`متصل — ${aiStatus.label}`, `Connected — ${aiStatus.label}`)
                    : t("لا يوجد مزوّد مُهيّأ", "No provider configured")}
                </h2>
                {aiStatus.available ? (
                  <div className="mt-1.5 space-y-2">
                    <p className="text-[11px] text-ink-faint" dir="ltr">
                      {aiStatus.model}
                    </p>
                    <div className="rounded-lg bg-surface-subtle px-2.5 py-2">
                      <p className="text-[10px] font-medium text-ink-soft">
                        {t("التبديل التلقائي بين الموديلات المجانية", "Automatic free-model failover")}
                      </p>
                      <p className="mt-0.5 text-[10px] text-ink-faint">
                        {t(
                          `${aiStatus.chain?.length ?? 1} موديل مجاني عبر ${aiStatus.providerCount ?? 1} مزوّد — لو تعطّل أي موديل ينتقل للتالي تلقائياً.`,
                          `${aiStatus.chain?.length ?? 1} free models across ${aiStatus.providerCount ?? 1} provider${(aiStatus.providerCount ?? 1) === 1 ? "" : "s"} — if one is down or rate-limited it switches automatically.`,
                        )}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1" dir="ltr">
                        {(aiStatus.chain ?? []).slice(0, 8).map((m, i) => (
                          <span
                            key={m}
                            className={cn(
                              "rounded px-1.5 py-0.5 font-mono text-[9px]",
                              i === 0 ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-ink-faint",
                            )}
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-ink-muted">
                    <p>
                      {t(
                        "أضف مفتاح مزوّد مجاني في متغيرات البيئة لتفعيل المساعد:",
                        "Add a free provider key to your environment variables to enable the assistant:",
                      )}
                    </p>
                    <ul className="space-y-0.5 font-mono text-[10px] text-ink-faint" dir="ltr">
                      <li>GROQ_API_KEY — free, fastest</li>
                      <li>GOOGLE_AI_API_KEY — Gemini free tier</li>
                      <li>OPENROUTER_API_KEY — free models</li>
                      <li>OLLAMA_BASE_URL — fully local, no key</li>
                    </ul>
                    <p className="pt-1">
                      {t(
                        "كل ميزات التطبيق الأخرى تعمل بالكامل بدون أي مزوّد.",
                        "Every other feature in the app works fully without a provider.",
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="mb-1 text-xs font-semibold text-ink">{t("صلاحيات المساعد", "Assistant permissions")}</h2>
            <p className="mb-4 text-[11px] leading-relaxed text-ink-muted">
              {t(
                "اختر بنفسك ما يطّلع عليه المساعد وما يمكنه إنشاؤه. لا شيء مُفعَّل تلقائياً — أنت من يمنح كل صلاحية، واضغط حفظ ليُسجَّل اختيارك.",
                "Choose exactly what the assistant may see and create. Nothing is on by default — you grant each permission, then press Save to record it.",
              )}
            </p>

            <ul className="space-y-2">
              {SCOPE_AREAS.map(({ area, labelAr, labelEn, descAr, descEn }) => {
                const readDef = ALL_SCOPES.find((s) => s.area === area && s.kind === "read");
                const writeDef = ALL_SCOPES.find((s) => s.area === area && s.kind === "write");
                const readOn = readDef ? draftScopes.has(readDef.scope) : false;
                const writeOn = writeDef ? draftScopes.has(writeDef.scope) : false;

                return (
                  <li
                    key={area}
                    className="rounded-xl border border-slate-200 px-3 py-2.5 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-ink">{t(labelAr, labelEn)}</p>
                        <p className="mt-0.5 text-[11px] text-ink-faint">{t(descAr, descEn)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleArea(area)}
                        className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-medium text-brand-600 transition-colors hover:bg-brand-50"
                      >
                        {readOn || writeOn ? t("إيقاف الكل", "Clear") : t("تفعيل الكل", "Enable all")}
                      </button>
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {[
                        { def: readDef, on: readOn },
                        { def: writeDef, on: writeOn },
                      ]
                        .filter((x): x is { def: typeof readDef; on: boolean } => Boolean(x.def))
                        .map(({ def, on }) => (
                          <button
                            key={def!.scope}
                            type="button"
                            onClick={() => toggleDraft(def!.scope)}
                            role="switch"
                            aria-checked={on}
                            className={cn(
                              "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                              on
                                ? "border-brand-500 bg-brand-50 text-brand-700"
                                : "border-slate-200 text-ink-muted hover:border-slate-300",
                            )}
                          >
                            <span
                              className={cn(
                                "flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border transition-colors",
                                on ? "border-brand-600 bg-brand-600" : "border-slate-300",
                              )}
                            >
                              {on ? <Check className="h-2.5 w-2.5 text-white" aria-hidden /> : null}
                            </span>
                            <span dir="ltr">{def!.kind === "read" ? t("قراءة", "Read") : t("إنشاء وتعديل", "Create & edit")}</span>
                          </button>
                        ))}
                    </div>
                  </li>
                );
              })}
            </ul>

            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-50">
              <button
                type="button"
                onClick={() => toggleDraft("memory:write")}
                role="switch"
                aria-checked={draftScopes.has("memory:write")}
                className={cn(
                  "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
                  draftScopes.has("memory:write") ? "bg-brand-600" : "bg-slate-300",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all",
                    draftScopes.has("memory:write") ? "start-[22px]" : "start-0.5",
                  )}
                />
              </button>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-ink">
                  {t("حفظ حقائق عنك", "Remember facts about you")}
                </span>
                <span className="block text-[11px] text-ink-faint">
                  {t(
                    "يتذكّر تفضيلاتك بين المحادثات.",
                    "Recalls your preferences across conversations.",
                  )}
                </span>
              </span>
            </label>

            {/* Save bar — the user confirms the grant set before it takes effect. */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <p className="text-[11px] text-ink-faint">
                {permissionsDirty
                  ? t("لديك تغييرات غير محفوظة.", "You have unsaved changes.")
                  : t(
                      `محفوظ · ${savedScopes.size} صلاحية مفعّلة`,
                      `Saved · ${savedScopes.size} permission${savedScopes.size === 1 ? "" : "s"} enabled`,
                    )}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraftScopes(new Set());
                    setPermissionsDirty(true);
                  }}
                  className="btn-secondary text-[11px]"
                  disabled={draftScopes.size === 0}
                >
                  {t("إلغاء الكل", "Disable all")}
                </button>
                <button
                  type="button"
                  onClick={savePermissionsNow}
                  disabled={isSavingPermissions || !permissionsDirty}
                  className="btn-primary text-[11px]"
                >
                  {isSavingPermissions ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  {t("حفظ", "Save")}
                </button>
              </div>
            </div>
          </div>

          <Link href="/settings/activity" className="card-interactive flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-ink-muted">
              <Brain className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-ink">{t("سجل نشاط المساعد", "Assistant activity log")}</p>
              <p className="text-[11px] text-ink-faint">
                {t("كل قراءة وكتابة، مع إمكانية التراجع.", "Every read and write, with undo available.")}
              </p>
            </div>
          </Link>
        </section>
      ) : null}

      {tab === "security" ? (
        <section className="space-y-5">
          <div className="card p-5">
            <h2 className="mb-1 flex items-center gap-2 text-xs font-semibold text-ink">
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
              {t("كلمة المرور", "Password")}
            </h2>
            <p className="mb-4 text-[11px] text-ink-muted">
              {t("10 أحرف على الأقل مع حرف كبير ورقم.", "At least 10 characters with an uppercase letter and a number.")}
            </p>
            <ChangePasswordForm isArabic={isArabic} />
          </div>

          <div className="card p-5">
            <h2 className="mb-1 flex items-center gap-2 text-xs font-semibold text-ink">
              <Monitor className="h-3.5 w-3.5" aria-hidden />
              {t("الأجهزة المتصلة", "Connected devices")}
            </h2>
            <p className="mb-4 text-[11px] leading-relaxed text-ink-muted">
              {t(
                "يمكنك تسجيل الخروج من أي جهاز عن بُعد. سيتم إلغاء جلساته فوراً.",
                "Sign out of any device remotely. Its sessions are revoked immediately.",
              )}
            </p>

            {devices.length === 0 ? (
              <p className="py-3 text-[11px] text-ink-faint">{t("لا أجهزة أخرى.", "No other devices.")}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {devices.map((device) => (
                  <li key={device.id} className="flex items-center gap-3 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-ink-muted">
                      <Monitor className="h-3.5 w-3.5" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-xs font-medium text-ink">
                        {device.name}
                        {device.isCurrent ? (
                          <span className="chip bg-emerald-50 text-emerald-700">
                            {t("هذا الجهاز", "This device")}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[10px] text-ink-faint">
                        {device.platform} · {formatRelativeTime(device.lastSeenAt, isArabic ? "ar" : "en")}
                      </p>
                    </div>
                    {!device.isCurrent ? (
                      <button
                        type="button"
                        onClick={() => revokeDevice(device.id)}
                        disabled={busyDevice === device.id}
                        className="btn-danger text-[11px]"
                      >
                        {busyDevice === device.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {t("خروج", "Sign out")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-5">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink">
              <Shield className="h-3.5 w-3.5" aria-hidden />
              {t("كيف نحمي بياناتك", "How your data is protected")}
            </h2>
            <ul className="space-y-2 text-[11px] leading-relaxed text-ink-muted">
              {[
                {
                  ar: "كل طلب مصادَق عليه، وكل وصول للبيانات مُصرَّح به ومربوط بحسابك فقط.",
                  en: "Every request is authenticated, and every data access is authorised and scoped to your account only.",
                },
                {
                  ar: "رموز الدخول قصيرة العمر، ولا تُخزَّن رموز التحديث الخام — نُخزّن تجزئتها فقط.",
                  en: "Access tokens are short-lived, and raw refresh tokens are never stored — only their hash is.",
                },
                {
                  ar: "إعادة استخدام رمز مسروق تُلغي كل الجلسات تلقائياً وتُسجَّل كحدث أمني.",
                  en: "A replayed stolen token automatically revokes every session and is logged as a security event.",
                },
                {
                  ar: "كل إجراء من المساعد يمر عبر بوابة واحدة مسجَّلة، وقابل للتراجع.",
                  en: "Every assistant action passes through one logged gateway and stays reversible.",
                },
              ].map((item) => (
                <li key={item.en} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
                  {t(item.ar, item.en)}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ChangePasswordForm({ isArabic }: { isArabic: boolean }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [isPending, startTransition] = useTransition();

  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const submit = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("currentPassword", current);
      formData.set("newPassword", next);
      const result = await changePasswordAction(undefined, formData);
      if (result.ok) {
        toast.success(t("حُدّثت كلمة المرور", "Password updated"));
        setCurrent("");
        setNext("");
      } else {
        toast.error(t("تعذّر التحديث", "Could not update the password"), result.error);
      }
    });
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="current-password" className="label">
          {t("كلمة المرور الحالية", "Current password")}
        </label>
        <input
          id="current-password"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="input"
          dir="ltr"
          autoComplete="current-password"
        />
      </div>
      <div>
        <label htmlFor="new-password" className="label">
          {t("كلمة المرور الجديدة", "New password")}
        </label>
        <input
          id="new-password"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="input"
          dir="ltr"
          autoComplete="new-password"
        />
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={isPending || !current || next.length < 10}
          className="btn-primary"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {t("تحديث كلمة المرور", "Update password")}
        </button>
      </div>
    </div>
  );
}
