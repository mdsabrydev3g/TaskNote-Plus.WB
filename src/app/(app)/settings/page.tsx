import type { Metadata } from "next";
import { desc, eq, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import { devices, sessions } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { SettingsView } from "@/components/settings-view";
import { aiStatus } from "@/lib/ai/gateway";
import { grantedScopes } from "@/app/actions/ai";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();

  const [deviceRows, sessionRows, grants] = await Promise.all([
    db
      .select()
      .from(devices)
      .where(and(eq(devices.userId, user.id), isNull(devices.revokedAt)))
      .orderBy(desc(devices.lastSeenAt))
      .limit(20),
    db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
      .orderBy(desc(sessions.lastSeenAt))
      .limit(20),
    grantedScopes(user.id),
  ]);

  const status = aiStatus();

  return (
    <SettingsView
      isArabic={user.locale === "ar"}
      aiStatus={{
        available: status.available,
        provider: status.provider,
        model: status.model,
        label: status.label,
        chain: status.chain,
        providerCount: status.providerCount,
      }}
      profile={{
        displayName: user.displayName,
        email: user.email,
        locale: user.locale,
        timezone: user.timezone,
        calendarSystem: user.calendarSystem,
        weekStartsOn: user.weekStartsOn,
        theme: user.theme,
      }}
      devices={deviceRows.map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        lastSeenAt: d.lastSeenAt.toISOString(),
        isCurrent: sessionRows.some((s) => s.deviceId === d.id && s.id === user.sessionId),
      }))}
      granted={[...grants]}
    />
  );
}
