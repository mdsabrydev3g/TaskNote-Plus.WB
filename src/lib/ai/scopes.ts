/**
 * AI permission model (§8.1 / §8.2)
 * ---------------------------------------------------------------------------
 * The user decides, per area, whether the assistant may READ it and whether it
 * may WRITE to it. Nothing is granted implicitly: a new workspace starts with
 * read access to nothing, and every capability is an explicit, revocable switch.
 *
 * Kept out of `actions/ai.ts` because a "use server" module may only export
 * async functions — this is a plain data table shared by the actions, the
 * settings UI, and the retrieval/tool gates.
 */

export type ScopeArea = "notes" | "tasks" | "calendar" | "projects" | "goals" | "inbox";

export type ScopeDef = {
  /** e.g. "notes:read" */
  scope: string;
  area: ScopeArea;
  kind: "read" | "write";
  labelAr: string;
  labelEn: string;
  descAr: string;
  descEn: string;
};

/** Areas in the order they appear in the UI, with a shared label. */
export const SCOPE_AREAS: Array<{
  area: ScopeArea;
  labelAr: string;
  labelEn: string;
  descAr: string;
  descEn: string;
}> = [
  {
    area: "notes",
    labelAr: "الملاحظات",
    labelEn: "Notes",
    descAr: "ملاحظاتك وملاحظات الاجتماعات",
    descEn: "Your notes and meeting minutes",
  },
  {
    area: "tasks",
    labelAr: "المهام",
    labelEn: "Tasks",
    descAr: "قائمة مهامك وحالتها",
    descEn: "Your task list and its status",
  },
  {
    area: "calendar",
    labelAr: "التقويم",
    labelEn: "Calendar",
    descAr: "المواعيد والاجتماعات",
    descEn: "Events and meetings",
  },
  {
    area: "projects",
    labelAr: "المشاريع",
    labelEn: "Projects",
    descAr: "المشاريع وما يتبعها",
    descEn: "Projects and what belongs to them",
  },
  {
    area: "goals",
    labelAr: "الأهداف",
    labelEn: "Goals",
    descAr: "الأهداف والعادات",
    descEn: "Goals and habits",
  },
  {
    area: "inbox",
    labelAr: "الوارد",
    labelEn: "Inbox",
    descAr: "ما التقطته ولم تُفرزه بعد",
    descEn: "Captured items not yet triaged",
  },
];

export const SCOPE_DEFS: ScopeDef[] = SCOPE_AREAS.flatMap(({ area, labelAr, labelEn }): ScopeDef[] => {
  const item = labelAr;
  const itemEn = labelEn.toLowerCase();
  return [
    {
      scope: `${area}:read`,
      area,
      kind: "read",
      labelAr: `قراءة ${item}`,
      labelEn: `Read ${itemEn}`,
      descAr: `يمكن للمساعد أن يبحث في ${item} ويستشهد بها في إجاباته.`,
      descEn: `The assistant may search ${itemEn} and cite them in answers.`,
    },
    {
      scope: `${area}:write`,
      area,
      kind: "write",
      labelAr: `إنشاء وتعديل ${item}`,
      labelEn: `Create & edit ${itemEn}`,
      descAr: `يمكن للمساعد أن ينشئ ${item} نيابةً عنك — كل إجراء قابل للتراجع.`,
      descEn: `The assistant may create ${itemEn} on your behalf — every action is reversible.`,
    },
  ];
});

/** Extra, non-area capabilities. */
export const EXTRA_SCOPES: ScopeDef[] = [
  {
    scope: "memory:write",
    area: "notes",
    kind: "write",
    labelAr: "حفظ حقائق عني",
    labelEn: "Remember facts about me",
    descAr: "يستطيع المساعد تذكّر تفضيلاتك بين المحادثات.",
    descEn: "The assistant may recall your preferences across conversations.",
  },
];

export const ALL_SCOPES: ScopeDef[] = [...SCOPE_DEFS, ...EXTRA_SCOPES];

export const ALL_SCOPE_KEYS = ALL_SCOPES.map((s) => s.scope);

/** Write tools are gated on the matching `<area>:write` grant. */
export const TOOL_SCOPE: Record<string, string> = {
  create_note: "notes:write",
  create_task: "tasks:write",
  create_event: "calendar:write",
  create_project: "projects:write",
  create_goal: "goals:write",
};

/** Retrieval sources are gated on the matching `<area>:read` grant. */
export const SOURCE_SCOPE: Record<string, string> = {
  note: "notes:read",
  task: "tasks:read",
  event: "calendar:read",
  project: "projects:read",
  goal: "goals:read",
  capture: "inbox:read",
};
