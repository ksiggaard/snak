// Headless regression check for the chat scroll behaviour, driven against the
// web-only mode (see AGENTS.md → "Web-only mode"). It loads the app in real
// Chrome, simulates streaming, and asserts the follow/disengage/jump/persist
// behaviours that were historically fragile.
//
// Prerequisites:
//   1. Dev server running:  npm run dev      (serves http://localhost:1420)
//   2. Google Chrome installed (default), or set CHROME_BIN to a Chromium binary.
//
// Run:   node scripts/web-debug/scroll-check.mjs
//        APP_URL=http://localhost:5173 node scripts/web-debug/scroll-check.mjs
//        CHROME_BIN=/path/to/chrome    node scripts/web-debug/scroll-check.mjs
import { chromium } from "playwright-core";

const URL = process.env.APP_URL || "http://localhost:1420";
const launchOpts = process.env.CHROME_BIN
  ? { executablePath: process.env.CHROME_BIN, headless: true }
  : { channel: "chrome", headless: true };

const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const metrics = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-chat-scroll]");
    return {
      top: Math.round(el.scrollTop),
      sh: el.scrollHeight,
      ch: el.clientHeight,
      gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
    };
  });

async function send(page, text) {
  const ta = page.locator("textarea").first();
  await ta.click();
  await ta.fill(text);
  await page.keyboard.press("Enter");
}

async function withPage(fn) {
  const browser = await chromium.launch(launchOpts);
  try {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-chat-scroll]", { timeout: 15000 });
    await fn(page);
  } finally {
    await browser.close();
  }
}

// 1. Follows the stream while parked at the bottom.
await withPage(async (page) => {
  await send(page, "stream a long reply please");
  await page.waitForTimeout(1500);
  const m = await metrics(page);
  check("follows stream while at bottom", m.gap <= 8, `gap=${m.gap}`);
});

// 2. Scrolling up mid-stream disengages — the view must not get yanked back.
await withPage(async (page) => {
  await send(page, "stream");
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    document.querySelector("[data-chat-scroll]").scrollTop -= 400;
  });
  const after = (await metrics(page)).top;
  await page.waitForTimeout(1200);
  const now = (await metrics(page)).top;
  check("scroll-up mid-stream stays put (no yank)", Math.abs(now - after) <= 50, `top ${after}->${now}`);
});

// 3. Sending after scrolling up jumps to the bottom (shows the new message).
await withPage(async (page) => {
  await page.evaluate(() => {
    document.querySelector("[data-chat-scroll]").scrollTop = 100;
  });
  await page.waitForTimeout(150);
  await send(page, "a brand new question after scrolling up");
  await page.waitForTimeout(400);
  const m = await metrics(page);
  check("send after scroll-up jumps to bottom", m.gap <= 8, `gap=${m.gap}`);
});

// 4. A sent message persists across a reload (localStorage-backed fake DB).
await withPage(async (page) => {
  await page.evaluate(() => localStorage.removeItem("snak-webdb-v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-chat-scroll]", { timeout: 15000 });
  const marker = "PERSIST-CHECK-7f3";
  await send(page, marker);
  await page.waitForFunction((mk) => document.body.innerText.includes(mk), marker, { timeout: 5000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-chat-scroll]", { timeout: 15000 });
  await page.waitForTimeout(600);
  const present = await page.evaluate((mk) => document.body.innerText.includes(mk), marker);
  check("sent message persists across reload", present);
});

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
