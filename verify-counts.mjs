// Verify: (1) Google is now a live second provider, (2) count questions answer correctly.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://tasknote-pluswb.vercel.app";
const stamp = Date.now();
const EMAIL = `cnt${stamp}@tasknote.app`;
const PASS = "Cnt1234Pass!";
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const bad = [];
page.on("response", (r) => {
  const u = r.url();
  if (r.status() >= 400 && !u.includes("forgot-password") && !u.includes("favicon"))
    bad.push(`${r.status()} ${u.slice(0, 90)}`);
});

// register
await page.goto(`${BASE}/register`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.fill('input[name="displayName"]', "Count Check");
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASS);
await page.click('button[type="submit"]');
await page.waitForTimeout(9000);
log("1. registered →", new URL(page.url()).pathname);

// grant permissions
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const tab = page.locator('button:has-text("المساعد والصلاحيات")').first();
if (await tab.count()) { await tab.click(); await page.waitForTimeout(1200); }
for (const s of await page.locator("button[role='switch']").all()) {
  if ((await s.getAttribute("aria-checked")) !== "true") { await s.click(); await page.waitForTimeout(60); }
}
const saves = page.locator('button:has-text("حفظ")');
await saves.nth((await saves.count()) - 1).click();
await page.waitForTimeout(4000);
log("2. permissions granted");

// check the failover chain now spans 2 providers
const settingsText = await page.locator("body").innerText();
const chain = settingsText.match(/(\d+)\s*(?:موديل|model)[^\n]*/);
log("3. chain line:", chain ? chain[0] : "(not found)");
const connected = settingsText.match(/متصل[^\n]*/);
log("   provider:", connected ? connected[0] : "(not found)");

// create exactly 3 tasks
await page.goto(`${BASE}/assistant`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
for (let i = 1; i <= 3; i++) {
  await page.locator("textarea").first().fill(`اعملي مهمة اسمها CT${stamp}_${i}`);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(13000);
}
log("4. created 3 tasks");

// THE QUESTION — exactly what the user asked
await page.locator("textarea").first().fill("how many Tasks ?");
await page.keyboard.press("Enter");
await page.waitForTimeout(18000);

const body = await page.locator("body").innerText();
const tail = body.slice(-700).replace(/\n+/g, " | ");
log("5. answer to 'how many Tasks ?':");
log("   …", tail.slice(-420));

// ground truth from the sidebar badge
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const nav = await page.locator('a:has-text("المهام"), a:has-text("Tasks")').first().innerText().catch(() => "");
log("6. sidebar badge says:", JSON.stringify(nav.replace(/\s+/g, " ").trim()));

log("\n--- errors ---");
log(bad.length ? [...new Set(bad)].slice(0, 6).join("\n") : "none");
log("account:", EMAIL, "/", PASS);
await browser.close();
