// End-to-end routing verification.
// Registers a fresh account, grants permissions via the Assistant tab, then
// checks that each instruction lands in the RIGHT module (and only that one).
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://tasknote-pluswb.vercel.app";
const stamp = Date.now();
const EMAIL = `diag${stamp}@tasknote.app`;
const PASS = "Diag1234Pass!";

const log = (...a) => console.log(...a);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

const bad = [];
page.on("response", (r) => {
  const u = r.url();
  if (r.status() >= 400 && !u.includes("forgot-password") && !u.includes("favicon"))
    bad.push(`${r.status()} ${u.slice(0, 100)}`);
});

// ---------- 1. Register
await page.goto(`${BASE}/register`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.fill('input[name="displayName"]', "Routing Test");
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASS);
await page.click('button[type="submit"]');
await page.waitForTimeout(9000);
log("1. register →", new URL(page.url()).pathname);
if (page.url().includes("/register")) {
  log("   FAILED:", (await page.locator("body").innerText()).slice(0, 250));
  await browser.close(); process.exit(1);
}

// ---------- 2. Open the Assistant & permissions tab
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const aiTab = page.locator('button:has-text("المساعد والصلاحيات"), button:has-text("Assistant & permissions")').first();
if (await aiTab.count()) { await aiTab.click(); await page.waitForTimeout(1500); log("2. opened Assistant tab"); }
else log("2. assistant tab button not found (may already be active)");

// ---------- 3. Enable every permission, then Save
const switches = await page.locator("button[role='switch']").all();
log("3. switches found:", switches.length);
for (const s of switches) {
  const on = (await s.getAttribute("aria-checked")) === "true";
  if (!on) { await s.click(); await page.waitForTimeout(70); }
}

const saves = page.locator('button:has-text("حفظ"), button:has-text("Save")');
const n = await saves.count();
log("   save buttons:", n);
await saves.nth(n - 1).click();
await page.waitForTimeout(4500);

const state = await page.locator("body").innerText();
const saved = state.match(/محفوظ[^\n]*|Saved ·[^\n]*/);
log("4. saved state:", saved ? saved[0] : "(not found)");

// ---------- 4. Ask the assistant to create one item of each kind
const items = {
  project: { name: `P${stamp}`, ask: `انشأ مشروع اسمه P${stamp}`, list: "/projects", sel: 'a[href^="/projects/"]' },
  task:    { name: `T${stamp}`, ask: `اعملي مهمة اسمها T${stamp}`, list: "/tasks", sel: '[href^="/tasks/"], li' },
  note:    { name: `N${stamp}`, ask: `اكتب ملاحظة بعنوان N${stamp} ومحتواها: تذكير بتجربة التوجيه`, list: "/notes", sel: 'a[href^="/notes/"]' },
};

await page.goto(`${BASE}/assistant`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

for (const [kind, it] of Object.entries(items)) {
  const box = page.locator("textarea").first();
  await box.fill(it.ask);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(14000);
  const reply = await page.locator("body").innerText();
  const tail = reply.slice(-260).replace(/\n+/g, " | ");
  log(`   asked for ${kind}: reply mentions name=${reply.includes(it.name)}`);
  log(`      …${tail.slice(-180)}`);
}

// ---------- 5. Verify each landed in its own module
log("\n5. module checks:");
const results = {};
for (const [kind, it] of Object.entries(items)) {
  await page.goto(`${BASE}${it.list}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const hits = await page.locator(`text=${it.name}`).count();
  results[kind] = hits;
  log(`   ${it.list.padEnd(10)} contains ${it.name}: ${hits > 0}`);
}

// Cross-contamination: count real NOTE ROWS (not page text) carrying each name.
// Matching raw body text gives false positives from the sidebar and chat.
await page.goto(`${BASE}/notes`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const noteRows = await page.locator('a[href^="/notes/"]').allInnerTexts();
const noteBlob = noteRows.join("\n");
const leaked = ["project", "task"].filter((k) => noteBlob.includes(items[k].name));
log("   note rows:", noteRows.length, "| wrongly filed as NOTE:", leaked.length ? leaked.join(", ") : "none");

log("\n--- errors ---");
log(bad.length ? [...new Set(bad)].slice(0, 8).join("\n") : "none");

const ok = results.project > 0 && results.task > 0 && results.note > 0 && leaked.length === 0;
log("\n=== VERDICT:", ok ? "PASS" : "FAIL", "===");
log("account:", EMAIL, "/", PASS);

await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "shot-verify.png" });
await browser.close();
process.exit(ok ? 0 : 1);
