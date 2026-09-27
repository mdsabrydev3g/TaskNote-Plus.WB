"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Keyboard,
  Loader2,
  Mic,
  MicOff,
  Save,
  Sparkles,
  Wand2,
} from "lucide-react";
import { capture as captureAction, suggestCaptureDestination as suggestCaptureDestinationAction } from "@/app/actions/tasks-bridge";
import { useToast } from "@/components/providers/toast-provider";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

type Suggestion = {
  type: "task" | "note" | "event";
  title: string;
  confidence: string;
  reason: string;
};

/**
 * Universal capture (§7.1). The core promise is that capture is *never*
 * blocked — the text is saved first, and AI triage happens afterwards as an
 * optional suggestion the user can accept or ignore.
 */
export function CaptureWorkspace({ isArabic }: { isArabic: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [text, setText] = useState("");
  const [lastCaptureId, setLastCaptureId] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, startSaveTransition] = useTransition();
  const [isTriaging, startTriageTransition] = useTransition();

  const t = (ar: string, en: string) => (isArabic ? ar : en);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // §15.2 keyboard-first: Cmd/Ctrl+Enter saves from anywhere in the field.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const save = async () => {
    const value = text.trim();
    if (!value) return;

    startSaveTransition(async () => {
      const result = await captureAction({ raw: value, kind: "text" });
      if (!result.ok || !result.data) {
        toast.error(t("تعذّر الحفظ", "Could not save"), result.error);
        return;
      }

      setLastCaptureId(result.data.id);
      setText("");

      if (result.data.duplicate) {
        toast.info(
          t("كنت قد التقطت هذا بالفعل", "You already captured this"),
          t("لم نُنشئ نسخة مكررة.", "No duplicate was created."),
        );
      } else {
        toast.success(t("حُفظ في الوارد", "Saved to your inbox"));
      }

      router.refresh();

      // Triage runs after the save, so a provider outage can never lose input.
      startTriageTransition(async () => {
        const triage = await suggestCaptureDestinationAction(result.data!.id);
        if (triage.ok && triage.data) {
          setSuggestion(triage.data);
        }
      });
    });
  };

  const toggleRecording = () => {
    const SpeechRecognition =
      typeof window !== "undefined"
        ? (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
            .SpeechRecognition ??
          (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
        : undefined;

    if (!SpeechRecognition) {
      toast.warning(
        t("الصوت غير مدعوم هنا", "Voice input unavailable"),
        t(
          "متصفحك لا يدعم التعرف على الكلام. يمكنك الكتابة أو استخدام تطبيق الموبايل.",
          "Your browser does not support speech recognition. Type instead, or use the mobile app.",
        ),
      );
      return;
    }

    if (isRecording) {
      setIsRecording(false);
      return;
    }

    // Arabic + English mixed input is a first-class requirement (§7.1).
    const recognition = new (SpeechRecognition as new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    })();

    recognition.lang = isArabic ? "ar-SA" : "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setText(transcript);
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);

    recognition.start();
    setIsRecording(true);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        title={t("التقاط سريع", "Quick capture")}
        subtitle={t(
          "أي شيء في ذهنك — اكتبه أو قُله. لا شيء يضيع.",
          "Anything on your mind — type it or say it. Nothing gets lost.",
        )}
      />

      <div className="card overflow-hidden">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t(
            "اكتب هنا... فكرة، مهمة، ملاحظة، رقم هاتف، أي شيء.",
            "Write here… an idea, a task, a note, a phone number, anything.",
          )}
          rows={8}
          className="w-full resize-none border-0 bg-transparent px-5 py-5 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
          aria-label={t("محتوى الالتقاط", "Capture content")}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleRecording}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium transition-colors",
                isRecording ? "bg-red-50 text-red-600" : "text-ink-muted hover:bg-slate-100 hover:text-ink",
              )}
              aria-pressed={isRecording}
            >
              {isRecording ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
              {isRecording ? t("إيقاف", "Stop") : t("صوت", "Voice")}
            </button>

            <span className="hidden items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs text-ink-faint sm:flex">
              <ImageIcon className="h-3.5 w-3.5" aria-hidden />
              {t("الصور: من تطبيق الموبايل", "Images: from the mobile app")}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[11px] text-ink-faint sm:flex">
              <Keyboard className="h-3.5 w-3.5" aria-hidden />
              ⌘↵
            </span>
            <button type="button" onClick={save} disabled={isSaving || !text.trim()} className="btn-primary">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              {t("التقاط", "Capture")}
            </button>
          </div>
        </div>
      </div>

      {/* AI triage suggestion — always optional, never blocking */}
      {isTriaging ? (
        <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-ink-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" aria-hidden />
          {t("نُفكّر أين ينتمي هذا...", "Thinking about where this belongs…")}
        </div>
      ) : suggestion ? (
        <div className="mt-4 rounded-2xl border border-brand-200 bg-brand-50/60 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-sm">
              <Wand2 className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-brand-900">
                {t("اقتراح", "Suggestion")}: {suggestion.title}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-brand-800/80">{suggestion.reason}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="chip bg-white text-brand-700">
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  {suggestion.type === "task"
                    ? t("مهمة", "Task")
                    : suggestion.type === "event"
                      ? t("موعد", "Event")
                      : t("ملاحظة", "Note")}
                </span>
                <span className="text-[11px] text-brand-700/70">
                  {suggestion.confidence === "high" ? t("ثقة عالية", "High confidence") : suggestion.confidence === "low" ? t("ثقة منخفضة", "Low confidence") : t("ثقة متوسطة", "Medium confidence")}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    router.push("/inbox");
                    setSuggestion(null);
                  }}
                  className="btn-secondary ms-auto"
                >
                  {t("راجع في الوارد", "Review in inbox")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {lastCaptureId && !isTriaging && !suggestion ? (
        <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          {t("محفوظ في الوارد. التقط شيئاً آخر.", "Saved to your inbox. Capture something else.")}
        </div>
      ) : null}

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: FileText,
            titleAr: "يُنشئ ملاحظة",
            titleEn: "Creates a note",
            bodyAr: "للفكرة الطويلة أو المحتوى المرجعي",
            bodyEn: "For a long idea or reference material",
          },
          {
            icon: Sparkles,
            titleAr: "يُحوَّل إلى مهمة",
            titleEn: "Becomes a task",
            bodyAr: "لأي شيء يحتاج فعلاً",
            bodyEn: "For anything that needs doing",
          },
          {
            icon: CheckCircle2,
            titleAr: "يُجدول كموعد",
            titleEn: "Scheduled as an event",
            bodyAr: "إذا كان له وقت محدد",
            bodyEn: "If it has a specific time",
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.titleEn} className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <Icon className="h-4 w-4 text-ink-faint" aria-hidden />
              <p className="mt-2 text-xs font-medium text-ink">{t(item.titleAr, item.titleEn)}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{t(item.bodyAr, item.bodyEn)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
