"use client";

import { useRef, useState, useTransition } from "react";
import { Bot, Loader2, Send, Sparkles, User, X } from "lucide-react";
import { askAssistant as askAssistantAction, aiStatus as getAiStatusAction } from "@/app/actions/tasks-bridge";
import { useToast } from "@/components/providers/toast-provider";
import { cn } from "@/lib/utils";
import type { Citation } from "@/db/schema";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
};

type Mode = "chat" | "summarize" | "extract_tasks";

/**
 * Grounded assistant (§7.7). Every answer carries its sources, and the empty
 * state is explicit about what the assistant can and cannot see.
 */
export function AssistantChat({
  isArabic,
  aiAvailable,
  providerLabel,
  initialMessages,
  threadId: initialThreadId,
}: {
  isArabic: boolean;
  aiAvailable: boolean;
  providerLabel: string;
  initialMessages: Message[];
  threadId: string | null;
}) {
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("chat");
  const [isPending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const send = () => {
    const text = input.trim();
    if (!text || isPending) return;

    const userMessage: Message = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      citations: [],
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    startTransition(async () => {
      const status = await getAiStatusAction();
      if (!status.available) {
        setMessages((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}-err`,
            role: "assistant",
            content: t(
              "المساعد غير مُهيّأ بعد. كل ما تلتقطه وتنظّمه يعمل بشكل طبيعي بدون أي مزوّد ذكاء اصطناعي.",
              "The assistant is not configured yet. Everything you capture and organise works normally without any AI provider.",
            ),
            citations: [],
          },
        ]);
        return;
      }

      const result = await askAssistantAction({ message: text, threadId, mode });
      if (result.ok && result.data) {
        setThreadId(result.data.threadId);
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: result.data!.answer,
            citations: result.data!.citations,
          },
        ]);
        window.setTimeout(() => {
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
        }, 50);
      } else {
        toast.error(t("تعذّر الحصول على رد", "Could not get a response"), result.error);
      }
    });
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] max-w-3xl flex-col px-4 py-6 lg:h-[calc(100dvh-9rem)] lg:px-8">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
            <Sparkles className="h-5 w-5 text-brand-600" aria-hidden />
            {t("المساعد", "Assistant")}
          </h1>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {aiAvailable
              ? t(`متصل عبر ${providerLabel}`, `Connected via ${providerLabel}`)
              : t("غير مُهيّأ — أضف مزوّداً من الإعدادات", "Not configured — add a provider in settings")}
          </p>
        </div>

        <div className="flex rounded-xl border border-slate-200 bg-white p-0.5">
          {(
            [
              { key: "chat", ar: "محادثة", en: "Chat" },
              { key: "summarize", ar: "لخّص", en: "Summarise" },
              { key: "extract_tasks", ar: "مهاماً", en: "Tasks" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setMode(item.key)}
              aria-pressed={mode === item.key}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                mode === item.key ? "bg-slate-100 text-ink" : "text-ink-faint hover:text-ink",
              )}
            >
              {isArabic ? item.ar : item.en}
            </button>
          ))}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto scrollbar-thin pb-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
              <Sparkles className="h-5 w-5" aria-hidden />
            </div>
            <p className="mt-4 text-sm font-medium text-ink">
              {t("اسأل عن أي شيء — أو اطلب مني أن أنفّذ", "Ask me anything — or tell me to do something")}
            </p>
            <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-muted">
              {t(
                "أجيب على أي سؤال من معرفتي العامة، وأبحث في ما سمحت لي بقراءته. ويمكنني أن أنشئ مهامك ومواعيدك ومشاريعك وأهدافك وملاحظاتك — حسب الصلاحيات التي منحتها لي.",
                "I answer any question from my own knowledge, and search whatever you have allowed me to read. I can also create your tasks, events, projects, goals and notes — within the permissions you grant.",
              )}
            </p>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {[
                { ar: "اعملي اجتماع بكرة الساعة 10", en: "Book me a meeting tomorrow at 10" },
                { ar: "ما الذي يجب أن أركّز عليه اليوم؟", en: "What should I focus on today?" },
                { ar: "حل لي هذه المسألة: 17 × 23 + 45", en: "Solve this: 17 × 23 + 45" },
              ].map((suggestion) => (
                <button
                  key={suggestion.en}
                  type="button"
                  onClick={() => setInput(isArabic ? suggestion.ar : suggestion.en)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-ink-soft transition-colors hover:border-brand-300 hover:text-brand-700"
                >
                  {isArabic ? suggestion.ar : suggestion.en}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}
            >
              {message.role === "assistant" ? (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Bot className="h-3.5 w-3.5" aria-hidden />
                </div>
              ) : null}

              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3",
                  message.role === "user"
                    ? "bg-brand-600 text-white"
                    : "border border-slate-200 bg-white text-ink-soft",
                )}
              >
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{message.content}</p>

                {message.citations.length > 0 ? (
                  <div className="mt-3 border-t border-slate-100 pt-2.5">
                    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                      {t("المصادر", "Sources")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {message.citations.slice(0, 6).map((citation) => (
                        <span
                          key={`${citation.sourceType}-${citation.sourceId}`}
                          className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] text-ink-muted"
                        >
                          {citation.sourceType}: {citation.label.slice(0, 32)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : message.role === "assistant" &&
                  aiAvailable &&
                  // Only note the absence of sources when the answer itself is
                  // empty. A count or list answer is derived from the live
                  // workspace totals, not from titled excerpts, so it has no
                  // citations yet is completely correct — saying "no matching
                  // source" there contradicts the answer above it.
                  message.content.trim().length === 0 ? (
                  <p className="mt-2.5 text-[10px] text-ink-faint">
                    {t(
                      "لم أجد مصدراً مطابقاً في مساحتك لهذا السؤال.",
                      "No matching source was found in your workspace for this question.",
                    )}
                  </p>
                ) : null}
              </div>

              {message.role === "user" ? (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-ink-muted">
                  <User className="h-3.5 w-3.5" aria-hidden />
                </div>
              ) : null}
            </div>
          ))
        )}

        {isPending ? (
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Bot className="h-3.5 w-3.5" aria-hidden />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-slate-200 pt-4">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={t("اكتب سؤالك...", "Type your question…")}
            className="input max-h-32 min-h-[44px] resize-none py-3"
            aria-label={t("رسالة", "Message")}
          />
          <button
            type="button"
            onClick={send}
            disabled={isPending || !input.trim()}
            className="btn-primary h-[44px] w-[44px] shrink-0 p-0"
            aria-label={t("إرسال", "Send")}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4 flip-rtl" aria-hidden />}
          </button>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[10px] text-ink-faint">
          <X className="h-2.5 w-2.5" aria-hidden />
          {t(
            "المساعد يقرأ فقط ما سمحت به، وكل إجراء مقترح ينتظر موافقتك.",
            "The assistant only reads what you allow, and every proposed action waits for your approval.",
          )}
        </p>
      </div>
    </div>
  );
}
