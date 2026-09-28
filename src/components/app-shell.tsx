"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  CheckSquare,
  Folder,
  Home,
  Inbox,
  LogOut,
  Menu,
  NotebookPen,
  Search,
  Settings,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/config";
import { logoutAction } from "@/app/actions/auth";
import { CommandPalette } from "@/components/command-palette";
import { LogoMark } from "@/components/logo";
import type { CurrentUser } from "@/lib/session";

const NAV = [
  { href: "/dashboard", labelAr: "لوحة اليوم", labelEn: "Today", Icon: Home, countKey: null },
  { href: "/inbox", labelAr: "الوارد", labelEn: "Inbox", Icon: Inbox, countKey: "inbox" },
  { href: "/tasks", labelAr: "المهام", labelEn: "Tasks", Icon: CheckSquare, countKey: "tasks" },
  { href: "/notes", labelAr: "الملاحظات", labelEn: "Notes", Icon: NotebookPen, countKey: "notes" },
  { href: "/projects", labelAr: "المشاريع", labelEn: "Projects", Icon: Folder, countKey: "projects" },
  { href: "/calendar", labelAr: "التقويم", labelEn: "Calendar", Icon: Calendar, countKey: "events" },
  { href: "/goals", labelAr: "الأهداف", labelEn: "Goals", Icon: Target, countKey: "goals" },
  { href: "/assistant", labelAr: "المساعد", labelEn: "Assistant", Icon: Sparkles, countKey: null },
] as const;

/** Live counts shown beside each section in the navigation. */
export type NavCounts = {
  inbox: number;
  tasks: number;
  notes: number;
  projects: number;
  events: number;
  goals: number;
};

const MOBILE_NAV = NAV.filter((n) =>
  ["/dashboard", "/tasks", "/notes", "/calendar", "/assistant"].includes(n.href),
);

function CountBadge({ value, active }: { value: number; active: boolean }) {
  // A zero still renders, muted: an empty section should read as "0 items",
  // not as a missing feature. The active row always gets emphasis.
  const empty = value <= 0;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        active
          ? "bg-brand-600 text-white"
          : empty
            ? "bg-slate-100 text-ink-faint"
            : "bg-slate-100 text-ink-muted",
      )}
      aria-label={`${value}`}
    >
      {value > 99 ? "99+" : value}
    </span>
  );
}

export function AppShell({
  user,
  counts,
  children,
}: {
  user: CurrentUser;
  counts: NavCounts;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const isArabic = user.locale === "ar";
  const t = (ar: string, en: string) => (isArabic ? ar : en);

  // §15.2 command palette (⌘K / Ctrl+K) is first-class.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const handleLogout = useCallback(async () => {
    await logoutAction();
    router.push("/login");
  }, [router]);

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));

  return (
    <div className="flex min-h-dvh bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 hidden w-64 shrink-0 border-e border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <LogoMark />
          <span className="text-[15px] font-semibold tracking-tight text-ink">{APP_NAME}</span>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-2" aria-label={t("التنقل الرئيسي", "Main navigation")}>
          {NAV.map(({ href, labelAr, labelEn, Icon, countKey }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-soft hover:bg-slate-100 hover:text-ink",
                )}
              >
                <Icon className={cn("h-[18px] w-[18px]", active ? "text-brand-600" : "text-ink-faint group-hover:text-ink-muted")} aria-hidden />
                <span className="flex-1">{t(labelAr, labelEn)}</span>
                {countKey ? <CountBadge value={counts[countKey]} active={active} /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="mb-2 flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-ink-muted transition-colors hover:border-slate-300 hover:bg-white"
          >
            <Search className="h-3.5 w-3.5" aria-hidden />
            <span className="flex-1 text-start">{t("بحث سريع...", "Quick search...")}</span>
            <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
              ⌘K
            </kbd>
          </button>

          <Link
            href="/settings"
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-slate-100"
          >
            <Settings className="h-[18px] w-[18px] text-ink-faint" aria-hidden />
            <span>{t("الإعدادات", "Settings")}</span>
          </Link>

          <div className="mt-2 flex items-center gap-3 rounded-xl bg-slate-50 p-2.5">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: user.avatarColor }}
              aria-hidden
            >
              {user.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-ink">{user.displayName}</p>
              <p className="truncate text-[11px] text-ink-faint">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-white hover:text-red-600"
              aria-label={t("تسجيل الخروج", "Sign out")}
              title={t("تسجيل الخروج", "Sign out")}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar drawer */}
      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 start-0 flex w-72 flex-col bg-white shadow-pop">
            <div className="flex h-16 items-center justify-between px-5">
              <div className="flex items-center gap-2.5">
                <LogoMark />
                <span className="text-[15px] font-semibold text-ink">{APP_NAME}</span>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg p-2 text-ink-muted hover:bg-slate-100"
                aria-label={t("إغلاق", "Close")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
              {NAV.map(({ href, labelAr, labelEn, Icon, countKey }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                      active ? "bg-brand-50 text-brand-700" : "text-ink-soft hover:bg-slate-100",
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" aria-hidden />
                    <span className="flex-1">{t(labelAr, labelEn)}</span>
                    {countKey ? <CountBadge value={counts[countKey]} active={active} /> : null}
                  </Link>
                );
              })}
              <Link href="/settings" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-slate-100">
                <Settings className="h-[18px] w-[18px]" aria-hidden />
                <span>{t("الإعدادات", "Settings")}</span>
              </Link>
            </nav>
            <div className="border-t border-slate-200 p-3">
              <button type="button" onClick={handleLogout} className="btn-secondary w-full">
                <LogOut className="h-4 w-4" aria-hidden />
                {t("تسجيل الخروج", "Sign out")}
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col lg:ps-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/85 px-4 backdrop-blur-md lg:h-16 lg:px-8">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-xl p-2 text-ink-soft transition-colors hover:bg-slate-100 lg:hidden"
            aria-label={t("فتح القائمة", "Open menu")}
          >
            <Menu className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-ink-faint transition-colors hover:border-slate-300 hover:bg-white lg:max-w-md"
          >
            <Search className="h-4 w-4" aria-hidden />
            <span className="flex-1 text-start text-[13px]">{t("ابحث في كل شيء...", "Search everything...")}</span>
          </button>

          <div className="ms-auto flex items-center gap-1.5">
            <Link
              href="/capture"
              className="hidden items-center gap-2 rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-700 active:scale-[0.98] sm:flex"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              {t("التقاط سريع", "Quick capture")}
            </Link>
            <Link
              href="/settings"
              className="rounded-xl p-2 text-ink-soft transition-colors hover:bg-slate-100 lg:hidden"
              aria-label={t("الإعدادات", "Settings")}
            >
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </header>

        <main className="min-w-0 flex-1 pb-24 lg:pb-10">{children}</main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
        aria-label={t("التنقل السريع", "Quick navigation")}
      >
        <div className="flex items-stretch justify-around">
          {MOBILE_NAV.map(({ href, labelAr, labelEn, Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  active ? "text-brand-600" : "text-ink-faint",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span>{t(labelAr, labelEn)}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} isArabic={isArabic} />
    </div>
  );
}
