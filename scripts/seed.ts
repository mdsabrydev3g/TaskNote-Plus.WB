/**
 * Seeds a demo workspace.
 *
 * Run with:  npm run db:seed
 * Requires DATABASE_URL to be set and migrations to have been applied.
 *
 * The demo account is useful for local development and for a first look at the
 * product. Do NOT run this against a production database.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { resolveConnectionString } from "../src/lib/db/connection";
import {
  captures,
  events,
  goalTasks,
  goals,
  notes,
  projects,
  tags,
  taskTags,
  tasks,
  users,
  workspaces,
} from "../src/db/schema";

const DEMO_EMAIL = "demo@tasknote.app";
const DEMO_PASSWORD = "Demo1234Pass";

async function main() {
  const found = resolveConnectionString();
  if (!found.url) {
    console.error(
      "No usable Postgres connection string found.\n" +
        "  Locally: put your Neon URL in .env.local (see .env.example).",
    );
    process.exit(1);
  }

  console.log(`Seeding via ${found.source}`);

  const sql = neon(found.url);
  const db = drizzle(sql);

  console.log("Seeding TaskNote Plus demo data…");

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  if (existing.length > 0) {
    console.log(`\nDemo user already exists (${DEMO_EMAIL}). Nothing to do.`);
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const inserted = await db
    .insert(users)
    .values({
      email: DEMO_EMAIL,
      passwordHash,
      displayName: "سارة العتيبي",
      locale: "ar",
      timezone: "Asia/Riyadh",
      calendarSystem: "both",
      weekStartsOn: 6,
      emailVerified: true,
    })
    .returning({ id: users.id });

  const userId = inserted[0].id;

  await db.insert(workspaces).values({ userId, name: "Personal", slug: "personal" });

  // ── Projects ──────────────────────────────────────────────────────────────
  const projectRows = await db
    .insert(projects)
    .values([
      {
        userId,
        name: "إطلاق المنتج",
        description: "الإعداد الكامل لإطلاق النسخة الأولى من المنصة، من التصميم حتى النشر.",
        color: "#6366f1",
        targetDate: new Date(Date.now() + 45 * 86400000),
      },
      {
        userId,
        name: "تعلّم الآلة العملي",
        description: "مسار تعلّم منظم: أساسيات، مشاريع تطبيقية، وقراءة أوراق بحثية.",
        color: "#06b6d4",
        targetDate: new Date(Date.now() + 120 * 86400000),
      },
      {
        userId,
        name: "الصحة واللياقة",
        description: "روتين مستقر للنوم والحركة والتغذية.",
        color: "#10b981",
      },
    ])
    .returning({ id: projects.id });

  const [launchProject, mlProject, healthProject] = projectRows;

  // ── Tags ──────────────────────────────────────────────────────────────────
  const tagRows = await db
    .insert(tags)
    .values([
      { userId, name: "عاجل", color: "#ef4444" },
      { userId, name: "اجتماعات", color: "#8b5cf6" },
      { userId, name: "قراءة", color: "#06b6d4" },
      { userId, name: "تسويق", color: "#f59e0b" },
    ])
    .returning({ id: tags.id, name: tags.name });

  // ── Tasks ─────────────────────────────────────────────────────────────────
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const taskRows = await db
    .insert(tasks)
    .values([
      {
        userId,
        projectId: launchProject.id,
        title: "اعتماد شاشات التصميم النهائية",
        description: "مراجعة شاشات التقاط ومهمات اليوم، واعتماد التعديلات الأخيرة قبل التسليم للمطورين.",
        priority: "urgent",
        energy: "deep",
        status: "in_progress",
        dueAt: new Date(today.getTime() + 6 * 3600000),
        estimateMinutes: 90,
        position: 100,
      },
      {
        userId,
        projectId: launchProject.id,
        title: "كتابة صفحة الهبوط",
        description: "النص الكامل للصفحة الرئيسية مع التركيز على تقليل التشتت.",
        priority: "high",
        energy: "deep",
        status: "todo",
        dueAt: new Date(today.getTime() + 2 * 86400000),
        estimateMinutes: 120,
        position: 200,
      },
      {
        userId,
        projectId: launchProject.id,
        title: "مراجعة أمان الإصدار الأول",
        description: "فحص المصادقة، الصلاحيات، وسياسات الوصول قبل الإطلاق.",
        priority: "high",
        energy: "deep",
        status: "todo",
        dueAt: new Date(today.getTime() + 5 * 86400000),
        position: 300,
      },
      {
        userId,
        projectId: launchProject.id,
        title: "حجز اجتماع مع فريق التسويق",
        priority: "medium",
        energy: "admin",
        status: "todo",
        dueAt: new Date(today.getTime() + 86400000),
        position: 400,
      },
      {
        userId,
        projectId: launchProject.id,
        title: "إعداد لوحة قياس الاستخدام",
        priority: "medium",
        energy: "light",
        status: "done",
        completedAt: new Date(today.getTime() - 2 * 86400000),
        position: 500,
      },
      {
        userId,
        projectId: launchProject.id,
        title: "تحديث خطة الإطلاق",
        priority: "medium",
        energy: "admin",
        status: "done",
        completedAt: new Date(today.getTime() - 86400000),
        position: 600,
      },
      {
        userId,
        projectId: mlProject.id,
        title: "إنهاء الفصل الثالث من كتاب التعلم العميق",
        priority: "medium",
        energy: "deep",
        status: "todo",
        dueAt: new Date(today.getTime() + 3 * 86400000),
        estimateMinutes: 60,
        position: 100,
      },
      {
        userId,
        projectId: mlProject.id,
        title: "بناء نموذج تصنيف بسيط",
        description: "مشروع تطبيقي على مجموعة بيانات صغيرة، مع تقييم الدقة.",
        priority: "high",
        energy: "deep",
        status: "todo",
        dueAt: new Date(today.getTime() + 10 * 86400000),
        estimateMinutes: 240,
        position: 200,
      },
      {
        userId,
        projectId: mlProject.id,
        title: "قراءة ورقة عن التمثيلات المتجهية",
        priority: "low",
        energy: "light",
        status: "todo",
        position: 300,
      },
      {
        userId,
        projectId: healthProject.id,
        title: "مشي 30 دقيقة",
        priority: "medium",
        energy: "light",
        status: "todo",
        dueAt: new Date(today.getTime() + 5 * 3600000),
        position: 100,
      },
      {
        userId,
        projectId: healthProject.id,
        title: "النوم قبل 11 مساءً",
        priority: "medium",
        energy: "admin",
        status: "todo",
        dueAt: new Date(today.getTime() + 10 * 3600000),
        position: 200,
      },
      {
        userId,
        title: "الاتصال بالمحاسب بخصوص الفاتورة",
        priority: "high",
        energy: "admin",
        status: "todo",
        dueAt: new Date(today.getTime() - 86400000),
        position: 50,
      },
      {
        userId,
        title: "تجديد الاشتراك السنوي",
        priority: "low",
        energy: "admin",
        status: "todo",
        dueAt: new Date(today.getTime() + 20 * 86400000),
        position: 60,
      },
    ])
    .returning({ id: tasks.id, title: tasks.title });

  // A couple of tag links so tag filtering has data.
  const urgentTask = taskRows[0];
  if (urgentTask) {
    await db
      .insert(taskTags)
      .values([{ taskId: urgentTask.id, tagId: tagRows[0].id, userId }])
      .onConflictDoNothing();
  }

  // ── Goals ─────────────────────────────────────────────────────────────────
  const goalRows = await db
    .insert(goals)
    .values([
      {
        userId,
        projectId: mlProject.id,
        title: "إتمام 12 كتاباً تقنياً هذا العام",
        description: "كتاب واحد شهرياً، مع ملاحظات تطبيقية لكل فصل.",
        kind: "goal",
        metricType: "count",
        targetValue: 12,
        currentValue: 4,
        unit: "كتاب",
        dueDate: new Date(now.getFullYear(), 11, 31),
      },
      {
        userId,
        projectId: healthProject.id,
        title: "الالتزام بالمشي اليومي",
        description: "ثلاثون دقيقة على الأقل، مع يومَي سماح في الأسبوع.",
        kind: "habit",
        metricType: "count",
        targetValue: 60,
        currentValue: 18,
        unit: "يوم",
        graceDaysPerWeek: 2,
        streakCurrent: 12,
        streakBest: 21,
        lastCheckInAt: new Date(today.getTime() - 86400000),
      },
      {
        userId,
        projectId: launchProject.id,
        title: "إنجاز مهام الإطلاق قبل الموعد",
        kind: "goal",
        metricType: "percent",
        targetValue: 100,
        currentValue: 40,
      },
    ])
    .returning({ id: goals.id });

  // Link launch tasks to the launch goal so progress rolls up bottom-up.
  const launchTaskIds = taskRows
    .slice(0, 5)
    .map((task) => task.id)
    .filter(Boolean);

  if (launchTaskIds.length > 0) {
    await db
      .insert(goalTasks)
      .values(launchTaskIds.map((taskId) => ({ goalId: goalRows[2].id, taskId, userId })))
      .onConflictDoNothing();
  }

  // ── Events ────────────────────────────────────────────────────────────────
  await db.insert(events).values([
    {
      userId,
      projectId: launchProject.id,
      title: "مراجعة أسبوعية للفريق",
      description: "متابعة التقدّم، العقبات، وخطة الأسبوع القادم.",
      startAt: new Date(today.getTime() + 10 * 3600000),
      endAt: new Date(today.getTime() + 11 * 3600000),
      timezone: "Asia/Riyadh",
      recurrence: "FREQ=WEEKLY;BYDAY=SU",
      kind: "event",
    },
    {
      userId,
      title: "وقت تركيز — كتابة صفحة الهبوط",
      startAt: new Date(today.getTime() + 13 * 3600000),
      endAt: new Date(today.getTime() + 15 * 3600000),
      timezone: "Asia/Riyadh",
      kind: "block",
    },
    {
      userId,
      projectId: mlProject.id,
      title: "جلسة دراسة: التمثيلات المتجهية",
      startAt: new Date(today.getTime() + 2 * 86400000 + 19 * 3600000),
      endAt: new Date(today.getTime() + 2 * 86400000 + 20 * 3600000),
      timezone: "Asia/Riyadh",
      recurrence: "FREQ=WEEKLY;BYDAY=TU,TH",
      kind: "event",
    },
    {
      userId,
      projectId: launchProject.id,
      title: "موعد الإطلاق المستهدف",
      startAt: new Date(today.getTime() + 45 * 86400000 + 9 * 3600000),
      endAt: new Date(today.getTime() + 45 * 86400000 + 10 * 3600000),
      timezone: "Asia/Riyadh",
      kind: "event",
    },
  ]);

  // ── Notes ─────────────────────────────────────────────────────────────────
  const noteRows = await db
    .insert(notes)
    .values([
      {
        userId,
        projectId: launchProject.id,
        title: "ملاحظات اجتماع التصميم",
        content: [
          { id: "b1", type: "heading", level: 2, text: "القرارات المتخذة" },
          { id: "b2", type: "bullet", text: "تقليل عدد النقرات للوصول إلى التقاط إلى نقرة واحدة." },
          { id: "b3", type: "bullet", text: "شاشة اليوم يجب أن تُظهر ثلاث مهام فقط كحد أقصى." },
          { id: "b4", type: "bullet", text: "الألوان الهادئة أولوية على الألوان اللامعة." },
          { id: "b5", type: "heading", level: 2, text: "يحتاج متابعة" },
          { id: "b6", type: "todo", text: "تأكيد تباين الألوان مع فريق الوصول", checked: false },
          { id: "b7", type: "todo", text: "اختبار الواجهة على شاشات صغيرة", checked: true },
          { id: "b8", type: "quote", text: "التصميم الجيد يُلاحَظ عندما لا يشتكي أحد." },
        ],
        contentText:
          "القرارات المتخذة\n- تقليل عدد النقرات للوصول إلى التقاط إلى نقرة واحدة.\n- شاشة اليوم يجب أن تُظهر ثلاث مهام فقط كحد أقصى.\n- الألوان الهادئة أولوية على الألوان اللامعة.\nيحتاج متابعة\n[ ] تأكيد تباين الألوان مع فريق الوصول\n[x] اختبار الواجهة على شاشات صغيرة\nالتصميم الجيد يُلاحَظ عندما لا يشتكي أحد.",
        pinned: true,
      },
      {
        userId,
        projectId: mlProject.id,
        title: "خطة تعلّم الآلة — 90 يوماً",
        content: [
          { id: "b1", type: "heading", level: 2, text: "المرحلة الأولى (30 يوماً)" },
          { id: "b2", type: "bullet", text: "الجبر الخطي والاحتمالات التطبيقية." },
          { id: "b3", type: "bullet", text: "أساسيات بايثون للبيانات: NumPy وPandas." },
          { id: "b4", type: "heading", level: 2, text: "المرحلة الثانية" },
          { id: "b5", type: "bullet", text: "بناء ثلاثة نماذج تطبيقية كاملة." },
          { id: "b6", type: "bullet", text: "قراءة ورقة بحثية أسبوعياً وتلخيصها." },
        ],
        contentText:
          "المرحلة الأولى (30 يوماً)\n- الجبر الخطي والاحتمالات التطبيقية.\n- أساسيات بايثون للبيانات: NumPy وPandas.\nالمرحلة الثانية\n- بناء ثلاثة نماذج تطبيقية كاملة.\n- قراءة ورقة بحثية أسبوعياً وتلخيصها.",
      },
      {
        userId,
        title: "أفكار للنمو",
        content: [
          { id: "b1", type: "bullet", text: "مقال عن سبب فشل تطبيقات الإنتاجية في الاستمرار." },
          { id: "b2", type: "bullet", text: "سلسلة قصيرة: كيف تنقلت من ثلاث أدوات إلى واحدة." },
          { id: "b3", type: "bullet", text: "تجربة: شهر كامل بدون إشعارات." },
        ],
        contentText:
          "- مقال عن سبب فشل تطبيقات الإنتاجية في الاستمرار.\n- سلسلة قصيرة: كيف تنقلت من ثلاث أدوات إلى واحدة.\n- تجربة: شهر كامل بدون إشعارات.",
      },
    ])
    .returning({ id: notes.id });

  // ── Captures ──────────────────────────────────────────────────────────────
  const { createHash } = await import("node:crypto");
  const hash = (value: string) => createHash("sha256").update(`text:${value.trim()}`).digest("hex");

  const rawCaptures = [
    "فكرة: إضافة وضع تركيز يخفي كل شيء عدا مهمة واحدة، مع مؤقّت هادئ.",
    "أراجع مع المحاسب موضوع ضريبة الربع الثالث",
    "اقتباس أعجبني: البساطة ليست غياب التعقيد، بل ترتيبه في مكان لا يُرى.",
    "تجربة: 45 دقيقة بلا هاتف بعد الاستيقاظ مباشرة",
  ];

  await db.insert(captures).values(
    rawCaptures.map((raw) => ({
      userId,
      raw,
      kind: "text",
      contentHash: hash(raw),
      processed: false,
    })),
  );

  console.log("\nSeed complete.\n");
  console.log("  Demo account");
  console.log(`    email:    ${DEMO_EMAIL}`);
  console.log(`    password: ${DEMO_PASSWORD}`);
  console.log(`\n  Projects: ${projectRows.length}`);
  console.log(`  Tasks:    ${taskRows.length}`);
  console.log(`  Goals:    ${goalRows.length}`);
  console.log(`  Notes:    ${noteRows.length}`);
  console.log(`  Captures: ${rawCaptures.length}`);
  console.log("\n  Open http://localhost:3000 and sign in.");
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
