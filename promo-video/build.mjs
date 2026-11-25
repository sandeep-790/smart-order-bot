// Builds the RoboCap product demo video.
//
//   node build.mjs            voice -> record -> mux  (everything)
//   node build.mjs voice      only generate narration (tmp/vo/*.m4a + tmp/vo.json)
//   node build.mjs record     only record the silent video (tmp/silent.mp4 + tmp/timeline.json)
//   node build.mjs mux        only mix narration + music into out/RoboCap-Demo.mp4
//
// Needs the app running at http://localhost:4000 (cd backend && npm start).
// Env: TTS_VOICE (Gemini voice, default Sulafat), TTS_MODEL (default gemini-2.5-pro-preview-tts),
//      VOICE_ENGINE=say to use the macOS "Tara" voice instead of Gemini,
//      FROM=<beat id> to start recording from a later beat (for iterating),
//      MUSIC=0 to skip the music bed, DUCK=<0-1> music level while the voice speaks.
// Voice, artwork and music come from Google Gemini (GOOGLE_API_KEY in ../.env):
//   voice  = Gemini TTS (Indian-English), checked by transcribing each clip back,
//   art    = assets/art/captain-*.jpg (gemini image model, one-off — see tmp/gen_art.mjs history),
//   music  = assets/music/bed.mp3 (Lyria 3.5), stretched to fit and ducked under the voice.
//
// How it works: stage.html is a 1920x1080 page holding story scenes, a phone
// frame with the live app in an iframe, captions and a tap cursor. We drive it
// with Playwright, capture the page with CDP screencast, and pipe frames at a
// constant 30 fps into ffmpeg. Each narration clip starts when its beat starts;
// those offsets are saved to the timeline and used to mix the audio afterwards.

import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(ROOT, "tmp");
const OUT = path.join(ROOT, "out");
const VO_DIR = path.join(TMP, "vo");
for (const d of [TMP, OUT, VO_DIR]) mkdirSync(d, { recursive: true });

const APP = "http://localhost:4000/";
const VOICE_ENGINE = process.env.VOICE_ENGINE || "gemini";
const TTS_MODEL = process.env.TTS_MODEL || "gemini-2.5-pro-preview-tts";
const TTS_VOICE = process.env.TTS_VOICE || "Sulafat";
const TTS_STYLE = "Read the following as a warm, friendly narrator with a natural Indian English accent, with an Indian cadence and intonation, at a relaxed, engaging pace: ";
const SAY_VOICE = "Tara"; // macOS fallback (en_IN)
const RATE = "165";
const FPS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Narration (what the voice says) — one entry per beat.
// ---------------------------------------------------------------------------
const NARRATION = {
  c1: "Think about how ordering used to work at a good restaurant. The captain walks up with a warm smile, and the whole evening feels easy.",
  c2: "He recommends the bestsellers. He explains what is spicy, what is mild, and what suits a vegetarian.",
  c3: "He suggests the perfect pairing, a hot filter coffee with that dosa, and then repeats your order back, so nothing ever goes wrong.",
  c4: "That personal guidance is what makes dining out feel special.",
  q1: "Then restaurants started going digital. QR codes arrived on every table, and diners now explore the entire menu on their own.",
  q2: "Scroll through every category. Compare dishes yourself. Customise sizes and extras. Tap after tap after tap. It works, but there is no captain to guide you, and a long menu can feel overwhelming.",
  i1: "Now, meet RoboCap. Your virtual captain, living right inside the menu, bringing the personal touch of a great captain to digital ordering.",
  d1: "Open RoboCap from the banner on the menu, and it greets you. No scrolling through the whole menu. Just tell it what you are in the mood for.",
  d2: "Not sure what to eat? Ask for the bestsellers, and RoboCap shows what everyone loves, with photos, prices, and a one tap add.",
  d3: "Torn between two dishes? Just type it. RoboCap puts them side by side, and tells you which one is best for what.",
  d4: "Want a recommendation? Ask for something spicy, and RoboCap suggests the dishes that fit.",
  d5: "Tap Add, choose your size and extras in one clean sheet, and it goes straight to your cart. And just like a real captain, RoboCap suggests a pairing.",
  d6: "Prefer to talk? Tap the mic and say what you want. RoboCap shows your words live, and you send when you are ready.",
  d7: "You can review your order at any time, and change quantities or edit an item.",
  d8: "Ready? Place your order. RoboCap asks how you would like it, dine in, pickup or delivery, and collects your details in a simple form.",
  d9: "One last review, one tap to confirm, and the kitchen gets your order.",
  d10: "And that is it. Order placed in about a minute, with the confidence of a captain by your side. Track it any time from the Orders tab.",
  o1: "RoboCap. Smarter ordering, with the warmth of a captain. Recommendations, comparisons, customisation and voice, all in one conversation. Give every diner a captain in their pocket.",
};

// ---------------------------------------------------------------------------
// Step 1: narration audio
// ---------------------------------------------------------------------------
function probeDuration(file) {
  return parseFloat(execFileSync(ffprobe.path, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
}

// --- Gemini helpers ---
function googleKey() {
  const envFile = path.join(ROOT, "..", ".env");
  const line = readFileSync(envFile, "utf8").split("\n").find((l) => l.startsWith("GOOGLE_API_KEY="));
  if (!line) throw new Error("GOOGLE_API_KEY missing in ../.env");
  return line.slice("GOOGLE_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
}
const GKEY = () => googleKey();
async function gemini(model, body) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GKEY()}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    if (![429, 500, 503].includes(r.status) || attempt === 4) throw new Error(`gemini ${model} ${r.status}: ${JSON.stringify(j).slice(0, 200).replace(GKEY(), "<key>")}`);
    await sleep(1500 * attempt);
  }
}
const normWords = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
function wordF1(a, b) {
  const A = normWords(a), B = normWords(b); const m = new Map();
  B.forEach((w) => m.set(w, (m.get(w) || 0) + 1));
  let hit = 0; A.forEach((w) => { if (m.get(w) > 0) { hit++; m.set(w, m.get(w) - 1); } });
  const p = hit / (A.length || 1), r = hit / (B.length || 1);
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}
// Transcribe a clip with Gemini so we can catch clips where the voice read the
// style instruction aloud, skipped words, or glitched.
async function transcribe(wavFile) {
  const j = await gemini("gemini-flash-latest", { contents: [{ parts: [
    { inlineData: { mimeType: "audio/wav", data: readFileSync(wavFile).toString("base64") } },
    { text: "Transcribe exactly what is spoken, word for word. Output only the transcript." }] }] });
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text).join(" ") || "";
}
function meanVolumeDb(file) {
  const out = spawnSyncText(ffmpegPath, ["-hide_banner", "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"]);
  const m = out.match(/mean_volume:\s*(-?[\d.]+) dB/);
  return m ? parseFloat(m[1]) : -20;
}
function spawnSyncText(cmd, args) {
  try { return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString() + ""; }
  catch (e) { return (e.stderr || "").toString() + (e.stdout || "").toString(); }
}

async function geminiClip(id, text) {
  const cacheKey = crypto.createHash("sha1").update([TTS_MODEL, TTS_VOICE, TTS_STYLE, text].join("|")).digest("hex").slice(0, 16);
  const cache = path.join(VO_DIR, `${id}.${cacheKey}.pcm`);
  const wav = path.join(VO_DIR, `${id}.wav`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (!existsSync(cache) || attempt > 1) {
      const j = await gemini(TTS_MODEL, {
        contents: [{ parts: [{ text: TTS_STYLE + text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } } } });
      const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      if (!part) { console.log(`  ${id}: no audio returned, retrying`); continue; }
      const buf = Buffer.from(part.inlineData.data, "base64");
      if (buf.slice(0, 4).toString() === "RIFF") { writeFileSync(wav, buf); } else {
        writeFileSync(cache, buf);
        execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", cache, wav]);
      }
    } else {
      execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", cache, wav]);
    }
    const heard = await transcribe(wav);
    const f1 = wordF1(text, heard);
    if (f1 >= 0.9) return { wav, f1 };
    console.log(`  ${id}: transcript match ${(f1 * 100).toFixed(0)}% — regenerating (attempt ${attempt})`);
    if (existsSync(cache)) rmSync(cache);
  }
  throw new Error(`could not get a clean voice clip for ${id}`);
}

async function makeVoice() {
  const meta = {};
  for (const [id, text] of Object.entries(NARRATION)) {
    const m4a = path.join(VO_DIR, `${id}.m4a`);
    let src, note = "";
    if (VOICE_ENGINE === "say") {
      src = path.join(VO_DIR, `${id}.aiff`);
      execFileSync("say", ["-v", SAY_VOICE, "-r", RATE, "-o", src, text]);
    } else {
      const clip = await geminiClip(id, text);
      src = clip.wav; note = ` (transcript match ${(clip.f1 * 100).toFixed(0)}%)`;
    }
    // even out clip loudness: bring every clip to about -20 dB mean volume
    const gain = Math.max(-9, Math.min(9, -20 - meanVolumeDb(src)));
    execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-af", `volume=${gain.toFixed(1)}dB`, "-ar", "44100", "-ac", "1", m4a]);
    meta[id] = { file: m4a, duration: probeDuration(m4a), text };
    console.log(`voice ${id}: ${meta[id].duration.toFixed(1)}s${note}`);
  }
  writeFileSync(path.join(TMP, "vo.json"), JSON.stringify(meta, null, 2));
  const total = Object.values(meta).reduce((s, m) => s + m.duration, 0);
  console.log(`narration total ${total.toFixed(0)}s (${VOICE_ENGINE === "say" ? "macOS " + SAY_VOICE : TTS_MODEL + " / " + TTS_VOICE})`);
  return meta;
}

// ---------------------------------------------------------------------------
// Step 2: record the stage
// ---------------------------------------------------------------------------

// Replaces the browser's speech recognition inside the app with a scripted one,
// so the real mic UI (listening state, live transcript, Stop -> Send) can be
// shown without a microphone. The app code path is unchanged.
const MOCK_SPEECH = `
(() => {
  class MockSR extends EventTarget {
    constructor() { super(); this.lang = ""; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1; this._on = false; }
    _emit(text, isFinal) {
      const ev = new Event("result");
      ev.resultIndex = 0;
      const res = [{ transcript: text }]; res.isFinal = isFinal;
      ev.results = [res];
      this.dispatchEvent(ev);
    }
    start() {
      this._on = true;
      const words = String(window.__voiceTranscript || "").split(" ").filter(Boolean);
      let i = 0;
      this._words = words.join(" ");
      this._t = setInterval(() => {
        if (!this._on) return;
        i++;
        this._emit(words.slice(0, i).join(" "), false);
        if (i >= words.length) clearInterval(this._t);
      }, 280);
    }
    stop() {
      if (!this._on) return;
      this._on = false; clearInterval(this._t);
      this._emit(this._words, true);
      setTimeout(() => this.dispatchEvent(new Event("end")), 60);
    }
    abort() { this._on = false; clearInterval(this._t); this.dispatchEvent(new Event("end")); }
  }
  window.SpeechRecognition = MockSR; window.webkitSpeechRecognition = MockSR;
})();
`;

async function record() {
  if (!existsSync(path.join(TMP, "vo.json"))) await makeVoice();
  const vo = JSON.parse(readFileSync(path.join(TMP, "vo.json"), "utf8"));
  const FROM = process.env.FROM || null;

  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await context.addInitScript(MOCK_SPEECH);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto("file://" + path.join(ROOT, "stage.html"));
  await page.waitForLoadState("load");
  await sleep(2500);
  const frame = page.frames().find((f) => f.url().startsWith(APP));
  if (!frame) throw new Error("app iframe not found — is the backend running on :4000?");
  await frame.waitForSelector(".robocap-banner", { timeout: 15000 });

  // ----- screencast -> ffmpeg (constant 30 fps) -----
  const silent = path.join(TMP, "silent.mp4");
  if (existsSync(silent)) rmSync(silent);
  const enc = spawn(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", silent,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const cdp = await context.newCDPSession(page);
  let latest = null, t0 = null, written = 0;
  // `speed` > 1 fast-forwards the film: wall-clock time passes `speed` times
  // faster than video time (frames in between are dropped). The film's own
  // clock — used for narration offsets, captions and sound cues — is the number
  // of frames written, so everything stays in sync when we fast-forward.
  let speed = 1, outAcc = 0, lastTick = Date.now();
  const FRAME_MS = 1000 / FPS;
  cdp.on("Page.screencastFrame", async (f) => {
    latest = Buffer.from(f.data, "base64");
    if (t0 === null) { t0 = Date.now(); lastTick = t0; }
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  const pump = setInterval(() => {
    const tick = Date.now(); const dt = tick - lastTick; lastTick = tick;
    if (t0 === null || !latest) return;
    outAcc += dt / speed;
    while (outAcc >= FRAME_MS) { enc.stdin.write(latest); written++; outAcc -= FRAME_MS; }
  }, 10);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  while (t0 === null) await sleep(20);
  const now = () => (written * 1000) / FPS; // film time in ms
  const untilOut = async (targetMs) => { while (now() < targetMs) await sleep(25); };

  // ----- helpers -----
  const timeline = [];
  const marks = [];
  const sfx = []; // sound-effect cues: { type: tap | whoosh | chime, t: ms since start }
  const show = async (...ids) => { sfx.push({ type: "whoosh", t: now() }); await S("show", ...ids); };
  const S = (fn, ...args) => page.evaluate(([f, a]) => window.stage[f](...a), [fn, args]);
  const app = (sel, opts) => frame.locator(sel, opts);

  let taps = 0;
  // Maps an element inside the (scaled) phone iframe to stage coordinates:
  // element rect in iframe CSS px -> scaled by the iframe's on-stage scale.
  async function moveCursorTo(loc, ms) {
    const local = await loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const pos = await page.evaluate(([lx, ly, d]) => {
      const fr = document.getElementById("app").getBoundingClientRect();
      const k = fr.width / document.getElementById("app").clientWidth;
      const x = fr.left + lx * k, y = fr.top + ly * k;
      const c = document.getElementById("cursor"); c.style.transitionDuration = d + "ms"; window.stage.cursor(x, y, false);
      return { x, y };
    }, [local.x, local.y, ms]);
    return pos;
  }
  // Move the cursor to an element, press ripple, then click it for real.
  async function tap(loc, { fast = false } = {}) {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await moveCursorTo(loc, fast ? 260 : 650);
    await sleep(fast ? 300 : 720);
    await page.evaluate(() => { const c = document.getElementById("cursor"); c.classList.remove("press"); void c.offsetWidth; c.classList.add("press"); });
    // DOM click: Playwright's own click point is inaccurate inside the CSS-scaled phone.
    await loc.evaluate((el) => el.click());
    sfx.push({ type: "tap", t: now() });
    taps++;
    if (fast) await S("counter", taps);
    await sleep(fast ? 220 : 380);
  }
  async function typeInto(sel, text, delay = 55) {
    const loc = app(sel);
    await moveCursorTo(loc, 600); await sleep(700);
    await loc.focus(); await sleep(250);
    await loc.pressSequentially(text, { delay });
    await sleep(350);
  }
  // Runs a wait that depends on the AI. The first ~2 s play in real time (so the
  // thinking animation is seen), anything longer is fast-forwarded 6x.
  async function ai(fn) {
    const timer = setTimeout(() => { speed = 6; }, 2000);
    try { return await fn(); } finally { clearTimeout(timer); speed = 1; }
  }
  const botCount = () => frame.evaluate(() => document.querySelectorAll(".message-row.bot:not(.bot-skeleton-row):not(.ai-think-row)").length);
  // Waits until RoboCap has finished replying: a new bot message exists and no
  // thinking panel / skeleton is on screen.
  async function waitReply(prev, timeoutMs = 60000) {
    return ai(async () => {
      const t = Date.now();
      while (Date.now() - t < timeoutMs) {
        const idle = await frame.evaluate(() => !document.getElementById("typingIndicator") && !document.querySelector(".bot-skeleton-row"));
        if (idle && (await botCount()) > prev) { await sleep(500); return; }
        await sleep(150);
      }
      throw new Error("timed out waiting for RoboCap");
    });
  }
  const scrollChatToEnd = () => frame.evaluate(() => { const a = document.getElementById("chatArea"); a.scrollTo({ top: a.scrollHeight, behavior: "smooth" }); });
  const menuScroll = (dy) => frame.evaluate((d) => document.getElementById("menuList").scrollBy({ top: d, behavior: "smooth" }), dy);

  // ----- beat runner -----
  let started = !FROM;
  async function beat(id, run, { kicker, captionHold = 350 } = {}) {
    if (!started) { if (id === FROM) started = true; else return; }
    const meta = vo[id];
    const start = now();
    timeline.push({ id, file: meta.file, startMs: start, duration: meta.duration });
    marks.push({ id, startMs: start });
    console.log(`[${(start / 1000).toFixed(1)}s] ${id}`);

    // captions: split into sentences, shown proportionally to their length
    const sentences = meta.text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) || [meta.text];
    const total = sentences.reduce((n, s) => n + s.length, 0);
    const captionTask = (async () => {
      let acc = 0;
      for (const s of sentences) {
        await S("caption", s);
        acc += (s.length / total) * meta.duration * 1000;
        await untilOut(start + acc);
      }
    })();
    const t = { at: (ms) => untilOut(start + ms) };
    const action = run ? run(t) : Promise.resolve();
    await Promise.all([action, captionTask]);
    await untilOut(start + meta.duration * 1000 + captionHold);
    await S("caption", null);
    await sleep(250);
  }

  // full-screen chapter title card (silent; the music breathes up under it)
  async function titleCard(kicker, headline, tone, holdMs = 2800) {
    await show("s-title");
    await S("title", kicker, headline, tone);
    await untilOut(now() + holdMs);
  }

  // =========================== the film ===========================
  await S("show");
  await sleep(600);
  await titleCard("Dining out", "The traditional way.", "#d4953f");

  // ---- Act 1: the traditional captain ----
  await beat("c1", async (t) => {
    await show("s-captain");
    await S("art", 0);
    await t.at(4800); await S("say", "captain", "Welcome! Have you dined with us before?"); await S("tickCaptain", "greet");
  });
  await beat("c2", async (t) => {
    await S("art", 1);
    await t.at(300); await S("say", "captain", "Our Masala Dosa is the bestseller. Crisp, golden, with three chutneys!"); await S("tickCaptain", "recommend");
    await t.at(2700); await S("say", "diner", "Is it spicy? I am vegetarian.");
    await t.at(4300); await S("say", "captain", "Fully vegetarian, and I can keep the spice mild or medium."); await S("tickCaptain", "explain");
  });
  await beat("c3", async (t) => {
    await S("art", 2);
    await t.at(300); await S("say", "captain", "Pair it with a hot filter coffee. Perfect combination!"); await S("tickCaptain", "pair");
    await t.at(4600); await S("art", 3); await S("say", "captain", "So, one Masala Dosa and one filter coffee. Shall I place it?"); await S("tickCaptain", "confirm");
  });
  await beat("c4", async (t) => { await t.at(200); await S("hideBubble"); });

  // ---- Act 2: the QR era, in fast forward ----
  await titleCard("Then came", "The QR menu era.", "#6f86f2");
  await beat("q1", async () => {
    await show("s-qr");
  });
  // fresh app session for the fast-forward tour
  await frame.evaluate(() => sessionStorage.clear());
  await beat("q2", async (t) => {
    await show("app-stage");
    await S("feature", "Without a captain", "Explore it all yourself", "Scroll, search, compare, customise. Every diner for themselves.");
    await S("counter", 0);
    await sleep(900);
    taps = 0;
    const fast = { fast: true };
    await menuScroll(500); await sleep(700);
    await menuScroll(600); await sleep(700);
    await tap(app("#categoriesFloatButton"), fast);
    await tap(app(".categories-popup button").nth(1), fast);
    await sleep(500);
    await tap(app('.menu-item-card[data-item-id] .menu-item-add-fab').nth(2), fast); // opens the customise sheet
    await sleep(600);
    await tap(app("#itemSheetAddBtn"), fast);
    await sleep(500);
    await menuScroll(700); await sleep(600);
    await tap(app(".menu-item-card .menu-item-add-fab").nth(5), fast);
    await sleep(500);
    if (await app("#itemSheetAddBtn").isVisible().catch(() => false)) await tap(app("#itemSheetAddBtn"), fast);
    await menuScroll(500); await sleep(500);
    await tap(app("#floatingCartButton"), fast);
    await sleep(700);
    await frame.evaluate(() => document.querySelector("#view-cart .panel-scroll")?.scrollBy({ top: 500, behavior: "smooth" }));
    await sleep(800);
    await tap(app("#proceedToCheckoutButton"), fast);
    await sleep(900);
  });
  await S("counter", null);

  // ---- Act 3: meet RoboCap ----
  // hidden reset so the demo starts from a clean cart and menu
  await beat("i1", async () => {
    await show("s-intro");
    await S("hideCursor");
    await frame.evaluate(() => sessionStorage.clear());
    await page.evaluate((u) => { document.getElementById("app").src = u; }, APP);
  });
  const frame2 = page.frames().find((f) => f.url().startsWith(APP));
  await frame2.waitForSelector(".robocap-banner", { timeout: 15000 });
  await sleep(1200);

  await S("setChecklistTitle", "RoboCap can");
  await S("clearChecklist");
  await S("hideCursor");

  await beat("d1", async (t) => {
    await show("app-stage");
    await S("feature", "Start", "One tap to a captain", "Open RoboCap right from the menu.");
    await t.at(2600);
    await tap(app(".robocap-banner"));
    await frame.waitForSelector("#chatSplashSkipButton", { state: "visible", timeout: 10000 });
    await sleep(900);
    await tap(app("#chatSplashSkipButton"));
    await frame.waitForSelector(".chat-reply-options--welcome .chat-reply-option", { timeout: 15000 });
    await sleep(900);
    await S("check", "Instant AI welcome");
  });

  await beat("d2", async (t) => {
    await S("feature", "Bestsellers", "What everyone loves", "Photos, prices and a one tap add.");
    const prev = await botCount();
    await tap(app(".chat-reply-options--welcome .chat-reply-option", { hasText: "bestsellers" }));
    await waitReply(prev);
    await frame.waitForSelector(".chat-item-list-wrap .chat-compare-card", { timeout: 20000 });
    await sleep(2200);
    await S("check", "Bestsellers on request");
  });

  await beat("d3", async (t) => {
    await S("feature", "Compare", "Side by side", "Which dish is best for what, at a glance.");
    const prev = await botCount();
    await typeInto("#chatInput", "Compare masala dosa and idli");
    await tap(app("#sendButton"));
    await waitReply(prev);
    await frame.waitForSelector(".chat-compare-wrap .chat-compare-card", { timeout: 20000 });
    await scrollChatToEnd();
    await sleep(1800);
    await S("check", "Side-by-side comparison");
  });

  await beat("d4", async (t) => {
    await S("feature", "Recommend", "Ask for a mood", "Spicy? Light? Under a budget? Just say it.");
    const prev = await botCount();
    await typeInto("#chatInput", "Recommend something spicy");
    await tap(app("#sendButton"));
    await waitReply(prev);
    await frame.waitForSelector(".chat-item-list-wrap .chat-compare-card", { timeout: 20000 });
    await scrollChatToEnd();
    await sleep(1800);
    await S("check", "Smart recommendations");
  });

  await beat("d5", async (t) => {
    await S("feature", "Customise", "One clean sheet", "Size, extras and quantity, then straight to the cart.");
    const prev = await botCount();
    const addBtn = app(".chat-item-list-wrap .chat-item-add-button").last();
    await tap(addBtn);
    await frame.waitForSelector("#itemSheetAddBtn", { state: "visible", timeout: 10000 });
    await sleep(1500);
    // pick a non-default option if there is one, to show customising
    const rows = app(".item-sheet-radio-row");
    if ((await rows.count()) > 1) { await tap(rows.nth(1)); await sleep(500); }
    await tap(app("#itemSheetAddBtn"));
    await waitReply(prev, 90000);
    await scrollChatToEnd();
    await sleep(2200);
    await S("check", "Customise and add in one tap");
    await S("check", "Pairing suggestions");
  });

  await beat("d6", async (t) => {
    await S("feature", "Voice", "Just say it", "Live transcript, then send when you are ready.");
    const prev = await botCount();
    await frame.evaluate(() => { window.__voiceTranscript = "Add one filter coffee to my order"; });
    await tap(app("#micButton"));
    await sleep(3300); // words stream in live
    await tap(app("#micButton")); // Stop
    await sleep(1000);
    await tap(app("#sendButton"));
    await waitReply(prev, 90000);
    await scrollChatToEnd();
    await sleep(1200);
    await S("check", "Voice ordering");
  });

  await beat("d7", async (t) => {
    await S("feature", "Your order", "Always in view", "Review, change quantities or edit an item.");
    await tap(app("#composerCartButton"));
    await frame.waitForSelector(".chat-cart-summary .review-item-row", { timeout: 15000 });
    await scrollChatToEnd();
    await sleep(1500);
    const plus = app('.chat-cart-summary [data-action="increase"]').first();
    await tap(plus);
    await sleep(1800);
    await S("check", "Live cart review");
  });

  await beat("d8", async (t) => {
    await S("feature", "Check out", "Dine in, pickup or delivery", "Details captured in one simple form.");
    const prev = await botCount();
    await tap(app(".chat-cart-summary-place-btn").last());
    await waitReply(prev, 90000);
    const dine = app(".chat-reply-option", { hasText: "Dine" }).last();
    await ai(() => dine.waitFor({ state: "visible", timeout: 15000 }));
    await scrollChatToEnd(); await sleep(800);
    await tap(dine);
    await ai(() => frame.waitForSelector(".chat-details-form:not(.chat-details-form--done) input", { timeout: 60000 }));
    await scrollChatToEnd(); await sleep(900);
    await typeInto('.chat-details-form:not(.chat-details-form--done) input[data-field="name"]', "Sandeep");
    await typeInto('.chat-details-form:not(.chat-details-form--done) input[data-field="phone"]', "9876543210");
    await S("check", "Fulfilment and details");
  });

  await beat("d9", async (t) => {
    await S("feature", "Confirm", "A final look", "One tap and the kitchen gets it.");
    let prev = await botCount();
    await tap(app(".chat-details-form:not(.chat-details-form--done) .chat-details-form-save"));
    // The AI decides how many questions come before the final review (it may ask
    // for special instructions, an order note, etc.), so react to whatever it
    // offers: confirm when asked, skip optional prompts, otherwise answer briefly.
    for (let i = 0; i < 8; i++) {
      await waitReply(prev, 90000).catch(() => {});
      await scrollChatToEnd();
      if (await app("#orderLockedBanner:not([hidden])").count()) break;
      const yes = app(".chat-reply-option--confirm:not(:disabled)").last();
      if (await yes.isVisible().catch(() => false)) { await sleep(1500); await tap(yes); break; }
      prev = await botCount();
      const skip = app(".chat-reply-option:not(:disabled)", { hasText: /no special|no thanks|no instructions|skip|nothing else|that's all/i }).last();
      if (await skip.isVisible().catch(() => false)) { await tap(skip); continue; }
      const next = app(".chat-reply-option:not(:disabled)", { hasText: /checkout|place order|proceed|confirm/i }).last();
      if (await next.isVisible().catch(() => false)) { await tap(next); continue; }
      // no chips to tap: answer in the box like a customer would
      await typeInto("#chatInput", "No, that is all");
      await tap(app("#sendButton"));
    }
    await ai(() => frame.waitForSelector("#orderLockedBanner:not([hidden])", { timeout: 90000 }));
    sfx.push({ type: "chime", t: now() });
    await S("check", "Review and confirm");
  });

  await beat("d10", async (t) => {
    await S("feature", "Done", "Order placed", "Track it any time from the Orders tab.");
    await sleep(2800);
    await tap(app("#trackOrderButton"));
    await sleep(1800);
    await S("check", "Order tracking");
  });

  // ---- Outro ----
  await S("hideCursor");
  await beat("o1", async () => {
    await show("s-outro");
  }, { captionHold: 1500 });
  await sleep(2500);

  // ----- finish -----
  clearInterval(pump);
  await cdp.send("Page.stopScreencast").catch(() => {});
  enc.stdin.end();
  await new Promise((r) => enc.on("close", r));
  await browser.close();
  writeFileSync(path.join(TMP, "timeline.json"), JSON.stringify({ totalMs: now(), timeline, marks, sfx }, null, 2));
  console.log(`recorded ${(now() / 1000).toFixed(0)}s -> ${silent}`);
}

// ---------------------------------------------------------------------------
// Step 3: mix audio (voice + music bed with ducking + sound effects), mux
// ---------------------------------------------------------------------------
const SR = 44100;

// 32-bit float mono WAV (what ffmpeg reads without conversion)
function writeWavF32(file, samples, sr) {
  const data = Buffer.alloc(samples.length * 4);
  samples.forEach((v, i) => data.writeFloatLE(v, i * 4));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(32, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
}

// --- tiny sound effects, synthesised (nothing to license) ---
function makeTick() {
  const n = Math.floor(0.09 * SR), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; b[i] = (Math.sin(2 * Math.PI * 1900 * t) * 0.5 + Math.sin(2 * Math.PI * 3800 * t) * 0.15) * Math.exp(-t * 70) * 0.35 + (Math.random() * 2 - 1) * Math.exp(-t * 400) * 0.18; }
  return b;
}
function makeWhoosh() {
  const dur = 0.85, n = Math.floor(dur * SR), b = new Float32Array(n); let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, p = t / dur;
    const cutoff = 300 + 3600 * Math.sin(Math.PI * p) ** 2;
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
    lp += a * ((Math.random() * 2 - 1) - lp);
    b[i] = lp * Math.sin(Math.PI * p) ** 2 * 0.9;
  }
  return b;
}
function makeChime() {
  const n = Math.floor(1.9 * SR), b = new Float32Array(n);
  [[659.25, 0], [987.77, 0.11], [1318.5, 0.22]].forEach(([f, delay]) => {
    for (let i = Math.floor(delay * SR); i < n; i++) {
      const t = i / SR - delay;
      b[i] += (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2 * t)) * Math.exp(-t * 2.6) * 0.16;
    }
  });
  return b;
}
function renderSfx(events, totalSec, file) {
  const out = new Float32Array(Math.ceil((totalSec + 2) * SR));
  const lib = { tap: [makeTick(), 0.9], whoosh: [makeWhoosh(), 0.55], chime: [makeChime(), 1] };
  for (const e of events) {
    const [buf, gain] = lib[e.type]; const o = Math.floor((e.t / 1000) * SR);
    for (let i = 0; i < buf.length && o + i < out.length; i++) out[o + i] += buf[i] * gain;
  }
  writeWavF32(file, out, SR);
}

// Decode any audio file to mono 4 kHz float samples (optionally tempo-stretched) —
// cheap material for loudness analysis.
function decodeLow(file, tempo) {
  const af = tempo ? `atempo=${tempo.toFixed(4)}` : "anull";
  return execFileSync(ffmpegPath, ["-v", "error", "-i", file, "-af", af, "-ac", "1", "-ar", "4000", "-f", "f32le", "pipe:1"], { maxBuffer: 1 << 28 });
}
// RMS in dB per window (default 0.5 s)
function rmsCurve(buf, win = 0.5) {
  const n = buf.length / 4, w = Math.floor(4000 * win), out = [];
  for (let s = 0; s + w <= n; s += w) { let sum = 0; for (let i = s; i < s + w; i++) { const v = buf.readFloatLE(i * 4); sum += v * v; } out.push(10 * Math.log10(sum / w + 1e-12)); }
  return out;
}

// --- music ducking: 1.0 when nobody speaks, `duck` while the narration plays,
// smooth attack/release so the music breathes instead of pumping ---
function renderDuckEnvelope(timeline, totalSec, duck, file, level = () => 1) {
  const sr = 4000, n = Math.ceil(totalSec * sr), target = new Float32Array(n).fill(1);
  for (const b of timeline) {
    const a = Math.max(0, Math.floor((b.startMs / 1000 - 0.2) * sr)), z = Math.min(n, Math.floor((b.startMs / 1000 + b.duration + 0.4) * sr));
    for (let i = a; i < z; i++) target[i] = duck;
  }
  const attack = 1 - Math.exp(-1 / (sr * 0.3)), release = 1 - Math.exp(-1 / (sr * 1.6));
  const env = Buffer.alloc(n * 4); let y = 1;
  for (let i = 0; i < n; i++) { y += (target[i] - y) * (target[i] < y ? attack : release); env.writeFloatLE(y * level(i / sr), i * 4); }
  writeFileSync(file, env);
}

function mux() {
  const { totalMs, timeline, sfx = [] } = JSON.parse(readFileSync(path.join(TMP, "timeline.json"), "utf8"));
  const silent = path.join(TMP, "silent.mp4");
  const final = path.join(OUT, "RoboCap-Demo.mp4");
  const total = totalMs / 1000;
  const bed = path.join(ROOT, "assets", "music", "bed.mp3");
  const useMusic = process.env.MUSIC !== "0" && existsSync(bed);
  const duck = parseFloat(process.env.DUCK || "0.09");

  const sfxFile = path.join(TMP, "sfx.wav");
  renderSfx(sfx, total, sfxFile);

  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", silent];
  timeline.forEach((b) => args.push("-i", b.file));
  const filters = [];
  const nVo = timeline.length;
  timeline.forEach((b, i) => filters.push(`[${i + 1}:a]adelay=${Math.round(b.startMs)}:all=1[v${i}]`));
  filters.push(timeline.map((_, i) => `[v${i}]`).join("") + `amix=inputs=${nVo}:normalize=0:dropout_transition=0,aecho=0.92:0.9:38|83:0.16|0.09,aformat=sample_rates=44100:channel_layouts=stereo[voice]`);

  let idx = nVo + 1;
  args.push("-i", sfxFile); const sfxIdx = idx++;
  filters.push(`[${sfxIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=0.55[sfx]`);

  let mixInputs = "[voice][sfx]", mixCount = 2;
  if (useMusic) {
    // calibrate: un-ducked music sits near -22 dB mean (voice clips are ~ -20 dB)
    const musicDur = probeDuration(bed);
    const meanDb = meanVolumeDb(bed);
    const gainDb = (-22 - meanDb).toFixed(1);
    const ratio = musicDur / total; // < 1: bed is shorter than the film -> slow it slightly so its ending lands at the end
    let tempo = "";
    if (ratio >= 0.8 && ratio <= 1.12) tempo = `atempo=${ratio.toFixed(4)},`;
    console.log(`music: ${musicDur.toFixed(0)}s bed for ${total.toFixed(0)}s film -> tempo ${ratio.toFixed(3)}; mean ${meanDb} dB -> gain ${gainDb} dB; duck ${duck}`);
    // Level the bed: the Lyria track is louder in some sections than others, so a
    // fixed duck leaves the voice fighting the music in the dense parts. Measure the
    // bed's loudness over time and ride it toward its median (slow, 4 s smoothing).
    const WIN = 0.5;
    const bedCurve = rmsCurve(decodeLow(bed, ratio >= 0.8 && ratio <= 1.12 ? ratio : 0), WIN);
    const med = [...bedCurve].sort((a, b) => a - b)[Math.floor(bedCurve.length / 2)];
    const smooth = bedCurve.map((_, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - 4); k <= Math.min(bedCurve.length - 1, i + 4); k++) { s += bedCurve[k]; c++; } return s / c; });
    const levelGain = smooth.map((db) => Math.min(1.5, Math.max(0.4, 10 ** ((med - db) / 20))));
    const level = (t) => { const x = t / WIN - 0.5, i = Math.max(0, Math.min(levelGain.length - 1, Math.floor(x))), j = Math.min(levelGain.length - 1, i + 1), f = Math.max(0, Math.min(1, x - i)); return levelGain[i] * (1 - f) + levelGain[j] * f; };
    const envFile = path.join(TMP, "duck.raw");
    renderDuckEnvelope(timeline, total, duck, envFile, level);

    // Report: how far the voice sits above the music during each beat (same 4 kHz measure for both)
    const gLin = 10 ** (parseFloat(gainDb) / 20);
    console.log("beat   voice dB   music dB   voice-over-music");
    for (const bt of timeline) {
      const vdb = rmsCurve(decodeLow(bt.file), 0.5); const voiceDb = 10 * Math.log10(vdb.reduce((s, d) => s + 10 ** (d / 10), 0) / vdb.length);
      const i0 = Math.floor(bt.startMs / 1000 / WIN), i1 = Math.min(bedCurve.length, Math.floor((bt.startMs / 1000 + bt.duration) / WIN));
      let p = 0, c = 0;
      for (let i = i0; i < i1; i++) { const t = (i + 0.5) * WIN; const g = level(t) * duck * gLin; p += 10 ** ((bedCurve[i] + 20 * Math.log10(g)) / 10); c++; }
      const musicDb = 10 * Math.log10(p / Math.max(1, c) + 1e-12);
      console.log(`${bt.id.padEnd(5)} ${voiceDb.toFixed(1).padStart(8)} ${musicDb.toFixed(1).padStart(10)} ${(voiceDb - musicDb).toFixed(1).padStart(12)} dB`);
    }
    args.push("-i", bed); const mIdx = idx++;
    args.push("-f", "f32le", "-ar", "4000", "-ac", "1", "-i", envFile); const eIdx = idx++;
    filters.push(`[${mIdx}:a]${tempo}aformat=sample_rates=44100:channel_layouts=stereo,volume=${gainDb}dB,equalizer=f=2200:t=q:w=0.9:g=-3.5,apad,atrim=0:${total.toFixed(2)},afade=t=in:d=1.5,afade=t=out:st=${(total - 3).toFixed(2)}:d=3[m0]`);
    filters.push(`[${eIdx}:a]aresample=44100,pan=stereo|c0=c0|c1=c0,apad,atrim=0:${total.toFixed(2)},aformat=sample_rates=44100:channel_layouts=stereo[e0]`);
    filters.push(`[m0][e0]amultiply[music]`);
    mixInputs += "[music]"; mixCount++;
  }
  filters.push(`${mixInputs}amix=inputs=${mixCount}:normalize=0:duration=longest[mix]`);
  filters.push(`[mix]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
  args.push("-filter_complex", filters.join(";"), "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", total.toFixed(2), "-movflags", "+faststart", final);
  execFileSync(ffmpegPath, args, { stdio: "inherit" });
  console.log(`done -> ${final} (${total.toFixed(0)}s)`);
}

// ---------------------------------------------------------------------------
const mode = process.argv[2] || "all";
if (mode === "voice" || mode === "all") await makeVoice();
if (mode === "record" || mode === "all") await record();
if (mode === "mux" || mode === "all") mux();
