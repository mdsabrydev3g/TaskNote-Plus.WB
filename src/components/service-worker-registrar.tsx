"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Registers the service worker so the web app is installable and usable
 * offline (§14.1). Also surfaces offline state, since §15.4 promises the app
 * keeps working without a connection and the user should know where they stand.
 */
export function ServiceWorkerRegistrar() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      const register = () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {
          /* Registration failure is non-fatal — the app still works online. */
        });
      };
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
    return undefined;
  }, []);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[90] flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-800 shadow-card">
      <WifiOff className="h-4 w-4" aria-hidden />
      <span>أنت غير متصل — التغييرات ستُزامَن عند العودة · Offline — changes will sync when you reconnect</span>
    </div>
  );
}
