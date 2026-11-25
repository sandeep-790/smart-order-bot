// Renders the LinkedIn video cover (out/RoboCap-Cover.jpg, 1920x1080):
// cover.html + the live app showing RoboCap's bestsellers in the phone.
// Needs the app running at http://localhost:4000.
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
await page.goto("file://" + path.join(ROOT, "cover.html"));
await sleep(2500);
const frame = page.frames().find((f) => f.url().startsWith("http://localhost:4000"));
const click = (sel, opts) => frame.locator(sel, opts).evaluate((el) => el.click());
await frame.waitForSelector(".robocap-banner");
await click(".robocap-banner");
await frame.waitForSelector("#chatSplashSkipButton", { state: "visible", timeout: 10000 });
await sleep(600);
await click("#chatSplashSkipButton");
await frame.waitForSelector(".chat-reply-options--welcome .chat-reply-option", { timeout: 15000 });
await sleep(800);
await frame.locator(".chat-reply-options--welcome .chat-reply-option", { hasText: "bestsellers" }).evaluate((el) => el.click());
await frame.waitForSelector(".chat-item-list-wrap .chat-compare-card", { timeout: 60000 });
await sleep(2500);
await frame.evaluate(() => { const a = document.getElementById("chatArea"); a.scrollTo({ top: a.scrollHeight, behavior: "instant" }); });
await sleep(900);
await page.screenshot({ path: path.join(ROOT, "out", "RoboCap-Cover.jpg"), type: "jpeg", quality: 93 });
await browser.close();
console.log("cover -> out/RoboCap-Cover.jpg");
