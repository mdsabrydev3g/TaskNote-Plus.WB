import type { Metadata } from "next";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, chatThreads } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { UserScope } from "@/lib/db/scope";
import { AssistantChat } from "@/components/assistant-chat";
import { aiStatus } from "@/lib/ai/gateway";

export const metadata: Metadata = { title: "Assistant" };

export default async function AssistantPage() {
  const user = await requireUser();
  const scope = new UserScope(user.id);

  // Resume the most recent thread so the conversation feels continuous.
  const threadRows = await db
    .select()
    .from(chatThreads)
    .where(scope.whereWithDeleted(chatThreads))
    .orderBy(desc(chatThreads.updatedAt))
    .limit(1);

  const thread = threadRows[0] ?? null;

  const messageRows = thread
    ? await db
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.threadId, thread.id), eq(chatMessages.userId, user.id)))
        .orderBy(asc(chatMessages.createdAt))
        .limit(100)
    : [];

  const status = aiStatus();

  return (
    <AssistantChat
      isArabic={user.locale === "ar"}
      aiAvailable={status.available}
      providerLabel={status.label}
      threadId={thread?.id ?? null}
      initialMessages={messageRows.map((message) => ({
        id: message.id,
        role: message.role as "user" | "assistant",
        content: message.content,
        citations: message.citations ?? [],
      }))}
    />
  );
}
