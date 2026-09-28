import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/session";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ToastProvider } from "@/components/providers/toast-provider";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";

export const metadata: Metadata = {
  title: {
    default: "TaskNote Plus",
    template: "%s · TaskNote Plus",
  },
  description:
    "TaskNote Plus — مساحة واحدة للملاحظات والمهام والمشاريع والأهداف والتقويم، مع مساعد ذكي يحترم خصوصيتك. One place for notes, tasks, projects, goals and calendar, with an assistant that respects your privacy.",
  applicationName: "TaskNote Plus",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "TaskNote Plus",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Only used to pick initial direction/theme, so a failure here degrades to
  // defaults rather than breaking the page.
  const user = await getCurrentUser().catch(() => null);
  const locale = user?.locale ?? "ar";
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        {/* Apply the stored theme before first paint so dark mode never flashes
            white. Mirrors ThemeProvider's resolution order: server value, then
            the local override, then the OS preference. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k="tnp-theme";var s=localStorage.getItem(k)||${JSON.stringify(
              (user?.theme as string) ?? "system",
            )};var d=s==="dark"||(s==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.dataset.theme=d?"dark":"light";}catch(e){}})();`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Cairo:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh bg-app">
        <ThemeProvider initialTheme={(user?.theme as "light" | "dark" | "system") ?? "system"}>
          <ToastProvider>
            {children}
            <ServiceWorkerRegistrar />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
