import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";

const schema = z.object({ theme: z.enum(["light", "dark", "system"]) });

/**
 * Persists the theme choice so it follows the user across devices. Failures
 * are non-fatal — the theme is already applied locally by the client.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid theme" }, { status: 400 });
  }

  await db
    .update(users)
    .set({ theme: parsed.data.theme, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return NextResponse.json({ ok: true });
}
