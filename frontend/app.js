// South Indian Cafe — RoboCap chat + guided ordering UI.
//
// The RoboCap tab sends free text (or a tapped quick-reply) to
// POST /api/chat, which calls a real AI provider (RoboCap — see
// backend/server.js) with tool-calling wired to the same order actions
// the Menu/Cart/Checkout views use, so chat and the guided UI share one
// live order/session.

// Relative — the backend serves this file itself (see backend/server.js,
// express.static), so API calls are always same-origin. If you ever run the
// frontend from a separate static server again, hardcode the backend's URL
// here instead (e.g. "http://localhost:3000").
const API_BASE = "";
const SESSION_STORAGE_KEY = "cafebotSessionId";

// Static, always-available conversation starters — not AI-generated.
// Trimmed to the 8 most frequently useful questions (dropped the
// lower-signal/overlapping ones: "full meal", "chef's picks" — redundant
// with "recommend something" — and the ₹500 price filter, since ₹200
// already covers the common budget question).
// Order matters: flex-wrap packs greedily in this exact array order (fills
// the current row, wraps only when the next chip doesn't fit — never
// backfills an earlier row), so this is a measured pairing (real rendered
// chip widths, bin-packed), not a random list — chosen to land exactly on
// 4 two-chip rows at a 375px mobile viewport with the container's real
// right-aligned layout (see .chat-reply-options--welcome).
const WELCOME_QUICK_REPLIES = [
  "👨‍🍳 recommend something",
  "🥗 Veg options",
  "🔥 What's special today?",
  "🌶️ spicy dishes",
  "⭐ Show bestsellers",
  "💰 items under ₹200",
  "🍗 Non-veg options",
  "👥 meal for two",
];

// Small inline icon set for menu item thumbnails — resolved from the
// "image": "icon:xxx" key in menu.json. No external images, nothing that
// can go missing; one definition reused everywhere.
const MENU_ICONS = {
  idli: { emoji: "🍥", bg: "#f4e9da" },
  vada: { emoji: "🍩", bg: "#f0deb8" },
  dosa: { emoji: "🌯", bg: "#f6e2b3" },
  rice: { emoji: "🍚", bg: "#eef2df" },
  biryani: { emoji: "🍛", bg: "#f7dcae" },
  snack: { emoji: "🥟", bg: "#f9dfc8" },
  filtercoffee: { emoji: "☕", bg: "#e3d0bd" },
  tea: { emoji: "🍵", bg: "#dcead9" },
  coolbeverage: { emoji: "🥤", bg: "#d9ecf2" },
  dessert: { emoji: "🍮", bg: "#f8e0e6" },
  nonveg: { emoji: "🍗", bg: "#f3d8d3" },
};

// menu.json's "image" field is either "icon:xxx" (emoji fallback, below) or
// a real photo path relative to frontend/assets/ (e.g. "menu/tif-idli.jpg")
// — real photos render as an <img>, sized/cropped by the same CSS rules
// that already size the SVG fallback in each call site's container.
function iconSvg(imageKey) {
  if (imageKey && !imageKey.startsWith("icon:")) {
    return `<img src="assets/${imageKey}" alt="" loading="lazy" />`;
  }
  const key = (imageKey || "").replace(/^icon:/, "");
  const spec = MENU_ICONS[key] || { emoji: "🍽️", bg: "#ece7dd" };
  return (
    `<svg viewBox="0 0 40 40" width="40" height="40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<circle cx="20" cy="20" r="20" fill="${spec.bg}" />` +
    `<text x="20" y="26" font-size="18" text-anchor="middle">${spec.emoji}</text>` +
    `</svg>`
  );
}

const chatArea = document.getElementById("chatArea");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatInputWrap = document.querySelector(".chat-input-wrap");
const chatInputPlaceholder = document.querySelector(".chat-input-placeholder");
const chatInputPlaceholderText = document.getElementById("chatInputPlaceholderText");
const sendButton = document.getElementById("sendButton");
const micButton = document.getElementById("micButton");
const orderLockedBanner = document.getElementById("orderLockedBanner");
const startOverButton = document.getElementById("startOverButton");

// Rotates the empty input's decorative placeholder overlay through example
// prompts, sliding the old phrase out upward and the new one in from below
// (a real <input placeholder> can't be animated). Hidden as soon as the
// input has real text so it never covers what the customer typed.
const CHAT_INPUT_PLACEHOLDERS = [
  "Ask RoboCap Anything...",
  "Show me today's specials",
  "What's good for breakfast?",
  "Recommend something spicy",
  "Compare masala dosa and idli",
  "Add 2 filter coffee to my order",
];
let chatInputPlaceholderIndex = 0;

// The mic fills chatInput.value directly (not via a real keystroke), which
// doesn't fire an "input" event — call this anywhere the value changes
// programmatically so the overlay never sits on top of real text.
function syncPlaceholderVisibility() {
  chatInputPlaceholder.hidden = chatInput.value.length > 0;
}

setInterval(() => {
  syncPlaceholderVisibility();
  if (chatInputPlaceholder.hidden) return;
  chatInputPlaceholderText.classList.add("leaving");
  setTimeout(() => {
    chatInputPlaceholderIndex = (chatInputPlaceholderIndex + 1) % CHAT_INPUT_PLACEHOLDERS.length;
    chatInputPlaceholderText.textContent = CHAT_INPUT_PLACEHOLDERS[chatInputPlaceholderIndex];
    chatInputPlaceholderText.classList.remove("leaving");
    chatInputPlaceholderText.classList.add("entering");
    void chatInputPlaceholderText.offsetWidth; // force reflow so the entry transition actually plays
    chatInputPlaceholderText.classList.remove("entering");
  }, 350);
}, 2000);

chatInput.addEventListener("input", syncPlaceholderVisibility);

// --- Text-to-speech (RoboCap speaks its own replies) -----------------------
// Real neural TTS via the backend's GET /api/tts (proxies to Sarvam AI's
// Bulbul model server-side, so the API key never reaches the browser) —
// sounds noticeably more human than the browser's built-in speechSynthesis.
// Pointing <audio src> straight at the streaming route (rather than
// fetch()-ing a blob and waiting for the whole clip) is what makes
// playback start quickly — the browser begins playing as audio arrives
// instead of waiting for the full response. One reusable <audio> element;
// reassigning its src is enough to abort whatever was still loading/playing,
// so no manual request-token bookkeeping is needed.
const MUTE_STORAGE_KEY = "robocapMuted";
let ttsMuted = localStorage.getItem(MUTE_STORAGE_KEY) === "true";
const ttsAudio = new Audio();

// The mute icons formerly lived on a single fixed header button — moved
// inline so a fresh copy can be attached to whichever bot message is
// currently the one being spoken.
const MUTE_ICON_ON =
  '<svg class="mute-icon-on" viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M4 10v4h4l5 4V6L8 10H4Z" fill="currentColor" />' +
  '<path d="M17 8a5 5 0 0 1 0 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />' +
  '<path d="M19.5 5.5a9 9 0 0 1 0 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.55" />' +
  "</svg>";
const MUTE_ICON_OFF =
  '<svg class="mute-icon-off" viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M4 10v4h4l5 4V6L8 10H4Z" fill="currentColor" />' +
  '<line x1="16" y1="9" x2="21" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round" />' +
  '<line x1="21" y1="9" x2="16" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round" />' +
  "</svg>";

function stopSpeaking() {
  ttsAudio.pause();
  ttsAudio.currentTime = 0;
}

// Builds the mute/unmute toggle for one specific bot message. Only the
// latest bot message is ever "under TTS", so appendMessage removes any
// leftover copy from a previous message before adding this one.
function buildMessageTtsToggle() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-tts-toggle";

  function updateUi() {
    button.classList.toggle("muted", ttsMuted);
    button.setAttribute("aria-pressed", String(ttsMuted));
    button.setAttribute("aria-label", ttsMuted ? "Unmute RoboCap voice" : "Mute RoboCap voice");
    button.innerHTML = MUTE_ICON_ON + MUTE_ICON_OFF;
  }
  updateUi();

  button.addEventListener("click", () => {
    ttsMuted = !ttsMuted;
    localStorage.setItem(MUTE_STORAGE_KEY, String(ttsMuted));
    updateUi();
    if (ttsMuted) stopSpeaking();
  });

  return button;
}

// Split from speak() so the TTS request can be kicked off (loadSpeech)
// while a reply is still pacing on the typing-indicator delay, and only
// started playing (playLoadedSpeech) once the text actually appears —
// by then the browser's already been buffering audio for however long
// that pause lasted, so playback starts right on the message instead of
// a beat after it, without changing when anything is actually spoken.
function loadSpeech(text) {
  if (ttsMuted || !text) return;
  stopSpeaking(); // a fast-arriving reply should never talk over the previous one
  ttsAudio.src = `${API_BASE}/api/tts?text=${encodeURIComponent(text)}`;
}

async function playLoadedSpeech() {
  if (ttsMuted) return;
  try {
    await ttsAudio.play();
  } catch (err) {
    // Autoplay can be blocked before any user gesture, and the request can
    // fail (not configured, rate-limited) — voice is optional, fail silent.
  }
}

async function speak(text) {
  if (ttsMuted || !text) return;
  loadSpeech(text);
  await playLoadedSpeech();
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Every AI reply pauses on the typing loader for at least this long (see
// sendChatMessage) so a fast response still feels like a considered answer
// instead of flashing the indicator for a few ms.
const MIN_TYPING_MS = 900;
// Item-card results (see appendItemList/appendComparisonCards) show a
// shimmering skeleton in their place for at least this long before the
// real cards swap in — same idea, applied to "fetching results" rather
// than "thinking of a reply". This runs AFTER the AI has already replied
// (the data is sitting there ready), so it's pure added wait, not overlap
// with real network time — kept short (just enough to avoid a jarring
// pop-in), since the AI round-trip before this already takes a second or
// more on its own.
const SKELETON_MIN_MS = 300;

// RoboCap's replies use markdown-style **bold** for item names and other
// important terms — escape first (this is model-generated text going into
// the DOM), then turn the already-escaped ** markers into <strong> tags.
function formatBotText(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function appendMessage(sender, text, options = {}) {
  const row = document.createElement("div");
  row.className = `message-row ${sender}`;

  if (sender === "bot") {
    const nameLabel = document.createElement("span");
    nameLabel.className = "bot-name-label";
    nameLabel.textContent = "✦ RoboCap";
    row.appendChild(nameLabel);
  }

  const bubbleWrap = document.createElement("div");
  bubbleWrap.className = "bubble-wrap";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (sender === "bot") {
    bubble.innerHTML = formatBotText(text);
    // The final order summary reads out its full item/price/fulfillment
    // text in the bubble, but speaking all of that is slow and redundant —
    // options.speakText lets a caller substitute a short spoken line while
    // the bubble still shows the complete text.
    // options.speechPreloaded lets a caller that already called loadSpeech()
    // (to start the TTS fetch early, e.g. during the typing-indicator pause)
    // just resume/play here instead of starting a fresh, later request.
    if (options.speechPreloaded) {
      playLoadedSpeech();
    } else {
      speak(options.speakText || text);
    }
  } else {
    bubble.textContent = text;
  }

  // Time (and, for bot messages, the mute toggle) sit below the bubble, not
  // inside it, so they read as metadata rather than part of the message.
  const meta = document.createElement("div");
  meta.className = "bubble-meta";
  const time = document.createElement("span");
  time.className = "message-time";
  time.textContent = formatTime(new Date());
  meta.appendChild(time);

  if (sender === "bot") {
    // Only the message actually being spoken should show the toggle — drop
    // it from whichever earlier message still has one.
    chatArea.querySelector(".message-tts-toggle")?.remove();
    meta.appendChild(buildMessageTtsToggle());
  }

  bubbleWrap.appendChild(bubble);
  bubbleWrap.appendChild(meta);
  row.appendChild(bubbleWrap);
  chatArea.appendChild(row);
  chatArea.scrollTop = chatArea.scrollHeight;
  return row;
}

function showTypingIndicator() {
  const row = document.createElement("div");
  row.className = "message-row bot";
  row.id = "typingIndicator";

  const nameLabel = document.createElement("span");
  nameLabel.className = "bot-name-label";
  nameLabel.textContent = "✦ RoboCap";
  row.appendChild(nameLabel);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';

  row.appendChild(bubble);
  chatArea.appendChild(row);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

// displayText lets the user bubble read differently from the actual
// message sent to the AI — e.g. the cart summary's "Place order" button
// shows "Place order" in the transcript while still sending the exact
// "Proceed to checkout" phrase the system prompt expects to trigger the
// checkout flow.
function sendQuickReply(value, displayText) {
  appendMessage("user", displayText || value);
  return sendChatMessage(value);
}

// Shown whenever the AI turn fails for any reason (network down, AI
// service unreachable, an unexpected server error) — deliberately never
// surfaces the underlying technical error (see sendChatMessage's catch),
// just a plain-language apology plus a way forward: retry the exact same
// message, or give up on chat and browse the menu directly.
function appendChatError(retryText) {
  appendMessage("bot", "I'm not able to process that right now. Please feel free to browse the menu, or try again.");

  const wrap = document.createElement("div");
  wrap.className = "chat-reply-options";

  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.className = "chat-reply-option chat-reply-option--primary";
  retryButton.innerHTML = "<span>↻ Retry</span>";
  retryButton.addEventListener("click", () => {
    retryButton.disabled = true;
    menuButton.disabled = true;
    appendMessage("user", retryText);
    sendChatMessage(retryText);
  });

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "chat-reply-option";
  menuButton.innerHTML =
    '<span class="chat-reply-option-icon chat-reply-option-icon--blue">🍽️</span><span>Browse Menu</span>';
  menuButton.addEventListener("click", () => {
    retryButton.disabled = true;
    menuButton.disabled = true;
    closeChatWindow();
  });

  wrap.append(retryButton, menuButton);
  chatArea.appendChild(wrap);
  chatArea.scrollTop = chatArea.scrollHeight;
}

// Small inline icon set for in-chat reply options (fulfillment, confirm,
// spice level, quantity, View Cart, checkout) — matched by pattern against
// the option's own text so it stays correct even if the AI phrases things
// slightly differently, with a generic fallback so an unrecognized option
// never breaks instead of just rendering label-only.
const REPLY_ICON_PICKUP =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M6 8h12l-1 12H7L6 8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M9 8V6a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="2"/></svg>';
const REPLY_ICON_DELIVERY =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<rect x="3" y="9" width="11" height="8" rx="1" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M14 12h4l3 3v2h-2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
  '<circle cx="7" cy="19" r="1.6" fill="currentColor"/><circle cx="17" cy="19" r="1.6" fill="currentColor"/></svg>';
const REPLY_ICON_DINEIN =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2"/>' +
  '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/></svg>';
const REPLY_ICON_CONFIRM =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M8 12l3 3 5-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const REPLY_ICON_EDIT =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M4 20l1-4L16 5l3 3L8 19l-4 1Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const REPLY_ICON_CHILI =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M14 3c2 1 2 3 1 4-3 3-8 8-8 12a3 3 0 0 0 5 2c4-4 8-9 8-12 0-2-1-4-3-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M13 3c1-1 3-1 4 1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const REPLY_ICON_QUANTITY =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const REPLY_ICON_CART =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<circle cx="9" cy="21" r="1.4" fill="currentColor"/><circle cx="18" cy="21" r="1.4" fill="currentColor"/>' +
  '<path d="M2.5 3h2l2.2 12.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L21 8H6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const REPLY_ICON_CHECKOUT =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const REPLY_ICON_DEFAULT =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M4 5h16v10H8l-4 4V5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

// Each rule pairs an icon with a "flavor" accent color so quick-reply chips
// read as a multi-color set (fulfillment options in blue, confirm in mint,
// spice level in berry, etc.) instead of one uniform accent.
const REPLY_CHIP_RULES = [
  [/^half\b|^full\b/i, null, "primary"],
  [/pickup/i, REPLY_ICON_PICKUP, "blue"],
  [/delivery/i, REPLY_ICON_DELIVERY, "blue"],
  [/dine.?in/i, REPLY_ICON_DINEIN, "blue"],
  [/^yes\b|confirm/i, REPLY_ICON_CONFIRM, "mint"],
  [/^no\b|change something/i, REPLY_ICON_EDIT, "neutral"],
  [/mild|medium|spicy/i, REPLY_ICON_CHILI, "berry"],
  [/^\d+$/, REPLY_ICON_QUANTITY, "amber"],
  [/view cart/i, REPLY_ICON_CART, "blue"],
  [/checkout/i, REPLY_ICON_CHECKOUT, "mint"],
];

function getReplyOptionIcon(value) {
  const rule = REPLY_CHIP_RULES.find(([pattern]) => pattern.test(value));
  return rule ? rule[1] : REPLY_ICON_DEFAULT;
}

function getReplyOptionFlavor(value) {
  const rule = REPLY_CHIP_RULES.find(([pattern]) => pattern.test(value));
  return rule ? rule[2] : "neutral";
}

// Renders plain-text reply options (fulfillment, confirm, spice level,
// quantity, View Cart, checkout, welcome starters) directly in the chat
// transcript — like appendItemList, but for simple tappable text choices
// instead of item cards. skipIcon is for the welcome starters, whose
// labels already carry their own emoji prefix — adding the usual SVG icon
// on top of that would double up.
// Welcome starters carry their own leading emoji baked into the label text
// (e.g. "🧑‍🍳 recommend something") rather than an SVG icon — split it off
// so it can render in its own colored icon box like every other chip,
// instead of sitting inline with the text.
function splitLeadingEmoji(value) {
  const match = value.match(/^(\S+)\s+(.*)$/);
  if (!match) return { icon: null, text: value };
  // Only treat the leading token as an icon if it has no letters — otherwise
  // it's just the first word of a label with no emoji (e.g. "Non-veg
  // options" before one was added), not an icon to split off.
  if (/[a-zA-Z]/.test(match[1])) return { icon: null, text: value };
  return { icon: match[1], text: match[2] };
}

// Welcome starters have no semantic category to derive a flavor from (see
// REPLY_CHIP_RULES), so they just cycle through the palette in order.
const WELCOME_CHIP_FLAVORS = ["blue", "mint", "amber", "berry", "grape", "neutral"];

function appendReplyOptions(options, { skipIcon = false } = {}) {
  const wrap = document.createElement("div");
  // The welcome starters read as things the customer might say, so they're
  // right-aligned like a user bubble instead of sitting under RoboCap's
  // own reply — skipIcon is unique to that context today.
  wrap.className = skipIcon ? "chat-reply-options chat-reply-options--welcome" : "chat-reply-options";
  options.forEach((value, index) => {
    const chip = document.createElement("button");
    chip.type = "button";

    if (skipIcon) {
      const { icon, text } = splitLeadingEmoji(value);
      const flavor = WELCOME_CHIP_FLAVORS[index % WELCOME_CHIP_FLAVORS.length];
      chip.className = "chat-reply-option";
      chip.innerHTML = icon
        ? `<span class="chat-reply-option-icon chat-reply-option-icon--${flavor}">${icon}</span><span>${text}</span>`
        : `<span>${text}</span>`;
    } else {
      const flavor = getReplyOptionFlavor(value);
      // Item-customization prompts (size, etc.) render as plain solid pills
      // with no icon.
      if (flavor === "primary") {
        chip.className = "chat-reply-option chat-reply-option--primary";
        chip.innerHTML = `<span>${value}</span>`;
      } else {
        chip.className = "chat-reply-option";
        chip.innerHTML =
          `<span class="chat-reply-option-icon chat-reply-option-icon--${flavor}">${getReplyOptionIcon(value)}</span>` +
          `<span>${value}</span>`;
      }
    }

    chip.addEventListener("click", async () => {
      // A tapped clarification (size, add-on, spice level, quantity, yes/no,
      // etc.) is only ever valid for the turn it was offered on — once the
      // customer acts on it (or moves on some other way), it's resolved or
      // stale, so disable every such block still sitting in the scrollback,
      // including this one. Welcome starters are exempt: they're general
      // browsing shortcuts, not a pending decision, so they stay usable.
      disableStaleReplyOptions();
      // "View Cart" shows the cart summary directly — it's not something
      // the AI needs to interpret, so skip the chat pipeline entirely.
      if (value === "View Cart") {
        appendMessage("user", value);
        appendCartSummary();
        return;
      }
      // Once checkout starts, the sticky cart bar no longer fits the flow —
      // hide it until the customer backs out of the review step.
      if (value === "Proceed to checkout") {
        checkoutStarted = true;
        hideOldViewCartChips();
        updateCartCount();
      }
      // Backing out of the final "Yes, confirm" / "No, let me change
      // something" prompt means the order isn't placed yet — bring the
      // sticky cart bar back so the customer can get back to their cart.
      if (value === "No, let me change something") {
        checkoutStarted = false;
        updateCartCount();
      }
      // Picking a fulfillment type is immediately followed by RoboCap asking
      // for name/phone/etc. conversationally — offer the same details as a
      // structured card too (Figma's "Your details" step), right after that
      // reply lands, as a second way to answer besides typing.
      const fulfillmentType = matchFulfillmentType(value);
      if (fulfillmentType) {
        await sendQuickReply(value);
        appendDetailsForm(fulfillmentType);
        return;
      }
      sendQuickReply(value);
    });
    wrap.appendChild(chip);
  });
  chatArea.appendChild(wrap);
  chatArea.scrollTop = chatArea.scrollHeight;
}

// Disables every non-welcome reply-option block still sitting in the
// scrollback — called whenever the conversation moves forward (a chip is
// tapped, text is typed, or an item is added directly) so a stale
// size/add-on/quantity/etc. prompt from an earlier turn can't be tapped
// into after the fact. Welcome starters are excluded on purpose — see
// appendReplyOptions.
function disableStaleReplyOptions() {
  chatArea.querySelectorAll(".chat-reply-options:not(.chat-reply-options--welcome) .chat-reply-option").forEach((c) => {
    c.disabled = true;
  });
  // A cart summary's "Place order" button is only ever valid for the cart
  // state it was rendered against — once the conversation moves forward
  // (including tapping this same button), any earlier one still in the
  // scrollback is stale.
  chatArea.querySelectorAll(".chat-cart-summary-place-btn").forEach((btn) => {
    btn.disabled = true;
  });
  // Same idea for the "Your details" card — if the customer moves on some
  // other way (types their details manually, taps a later chip) instead of
  // using it, an unanswered one left in the scrollback is stale.
  chatArea.querySelectorAll(".chat-details-form:not(.chat-details-form--done)").forEach((form) => {
    form.classList.add("chat-details-form--done");
    form.querySelectorAll("button, input").forEach((el) => {
      el.disabled = true;
    });
  });
}

// Hides every View Cart chip currently sitting in the scrollback — called
// right before a new one is offered (so only the latest turn's ever stays
// tappable) and once checkout starts (so it can't be tapped into afterward).
function hideOldViewCartChips() {
  chatArea.querySelectorAll(".chat-reply-option").forEach((c) => {
    if (c.textContent.includes("View Cart")) c.closest(".chat-reply-options").hidden = true;
  });
}

function matchFulfillmentType(value) {
  if (/pickup/i.test(value)) return "pickup";
  if (/delivery/i.test(value)) return "delivery";
  if (/dine.?in/i.test(value)) return "dine_in";
  return null;
}

// Field sets per fulfillment type — matches exactly what the backend's own
// pickup/dine-in/delivery routes accept (see server.js), so the composed
// message below never asks for something the AI can't actually use.
const DETAILS_FORM_FIELDS = {
  pickup: [
    { key: "name", label: "Your name", type: "text", required: true },
    { key: "pickupTime", label: "Pickup time (optional)", type: "text", required: false },
  ],
  dine_in: [
    { key: "name", label: "Your name", type: "text", required: true },
    { key: "phone", label: "Phone number", type: "tel", required: true },
  ],
  delivery: [
    { key: "name", label: "Your name", type: "text", required: true },
    { key: "phone", label: "Phone number", type: "tel", required: true },
    { key: "address", label: "Delivery address", type: "text", required: true },
    { key: "apartmentUnit", label: "Apartment / unit (optional)", type: "text", required: false },
    { key: "instructions", label: "Delivery instructions (optional)", type: "text", required: false },
  ],
};

// Turns the filled-in fields into the same kind of plain sentence a
// customer would type themselves — this is what actually gets sent, through
// the normal chat pipeline, so the AI parses it exactly like free text.
function composeDetailsMessage(fulfillmentType, values) {
  if (fulfillmentType === "pickup") {
    let msg = `My name is ${values.name}`;
    if (values.pickupTime) msg += `, pickup time ${values.pickupTime}`;
    return msg;
  }
  if (fulfillmentType === "dine_in") {
    return `My name is ${values.name}, phone ${values.phone}`;
  }
  let msg = `My name is ${values.name}, phone ${values.phone}, delivery address ${values.address}`;
  if (values.apartmentUnit) msg += `, apartment/unit ${values.apartmentUnit}`;
  if (values.instructions) msg += `. Delivery instructions: ${values.instructions}`;
  return msg;
}

// Structured "Your details" card (Figma), offered right after a fulfillment
// type is picked — a second way to give name/phone/address/etc. besides
// typing them conversationally. Submitting composes a normal sentence from
// the fields and sends it through sendQuickReply, same as any typed
// message — no new API, no bypass of the AI's own confirmation/address
// read-back rules downstream.
function appendDetailsForm(fulfillmentType) {
  const fields = DETAILS_FORM_FIELDS[fulfillmentType];
  const wrap = document.createElement("div");
  wrap.className = "chat-details-form";

  wrap.innerHTML =
    '<div class="chat-details-form-header">Your details</div>' +
    fields
      .map(
        (f) =>
          `<label class="chat-details-form-field"><span>${escapeHtml(f.label)}</span>` +
          `<input type="${f.type}" data-field="${f.key}" ${f.required ? "required" : ""} /></label>`
      )
      .join("") +
    '<p class="chat-details-form-lock">🔒 Only used for this order.</p>' +
    '<div class="chat-details-form-actions">' +
    '<button type="button" class="chat-details-form-save">Save and continue</button>' +
    '<button type="button" class="chat-details-form-later">I\'ll type it instead</button>' +
    "</div>";

  const saveButton = wrap.querySelector(".chat-details-form-save");
  const laterButton = wrap.querySelector(".chat-details-form-later");
  const inputs = wrap.querySelectorAll("input");

  function setBusy(busy) {
    saveButton.disabled = busy;
    laterButton.disabled = busy;
    inputs.forEach((input) => (input.disabled = busy));
  }

  saveButton.addEventListener("click", () => {
    const values = {};
    for (const input of inputs) {
      if (input.required && !input.value.trim()) {
        input.reportValidity();
        return;
      }
      values[input.dataset.field] = input.value.trim();
    }
    setBusy(true);
    wrap.classList.add("chat-details-form--done");
    sendQuickReply(composeDetailsMessage(fulfillmentType, values));
  });

  laterButton.addEventListener("click", () => {
    setBusy(true);
    wrap.classList.add("chat-details-form--done");
  });

  chatArea.appendChild(wrap);
  chatArea.scrollTop = chatArea.scrollHeight;
}

// Renders the current cart as an in-chat summary block — appended once,
// then re-rendered in place by changeChatCartItemQuantity whenever a line
// is adjusted, so tapping "View Cart" keeps the customer on the chat tab
// instead of jumping to a separate view.
async function appendCartSummary() {
  const block = document.createElement("div");
  block.className = "chat-cart-summary";
  chatArea.appendChild(block);
  await renderCartSummaryBlock(block);
  chatArea.scrollTop = chatArea.scrollHeight;
}

const FULFILLMENT_LABELS = { pickup: "Pickup", delivery: "Delivery", dine_in: "Dine-in" };

async function renderCartSummaryBlock(block) {
  block.innerHTML = '<span class="chat-item-add-status">Loading cart…</span>';
  try {
    const data = await apiGet("/api/order/review");
    const review = data.review;
    const count = review.items.reduce((sum, i) => sum + i.quantity, 0);
    const fulfillmentLabel = FULFILLMENT_LABELS[review.fulfillment && review.fulfillment.type] || null;

    const itemRows = review.items
      .map((item) => {
        const addOnNames = (item.addOns || []).map((a) => a.name).join(", ");
        return `
          <div class="review-item-row" data-line-id="${item.lineId}">
            <div class="review-item-top">
              <span class="review-item-name">${escapeHtml(item.name)}</span>
              <div class="chat-item-qty-stepper">
                <button type="button" data-action="decrease" aria-label="Decrease quantity">−</button>
                <span>${item.quantity}</span>
                <button type="button" data-action="increase" aria-label="Increase quantity">+</button>
              </div>
            </div>
            <div class="review-item-detail-rows">
              <div class="review-item-detail-lines">
                ${item.size ? `<span class="review-item-detail"><b>Type:</b> ${escapeHtml(item.size)}</span>` : ""}
                <span class="review-item-detail"><b>Extras:</b> ${addOnNames ? escapeHtml(addOnNames) : "-"}</span>
                <button type="button" class="review-item-change" data-action="change">Change</button>
              </div>
              <span class="review-item-price">${formatMoney(item.lineTotal)}</span>
            </div>
          </div>
        `;
      })
      .join("");

    block.innerHTML = `
      <div class="chat-cart-summary-icon"><span>${REPLY_ICON_CART}</span></div>
      <div class="chat-cart-summary-header">
        <span class="chat-cart-summary-label">Your order</span>
        <span class="chat-cart-summary-count">${count} item${count === 1 ? "" : "s"}${fulfillmentLabel ? ` · ${fulfillmentLabel}` : ""}</span>
      </div>
      <div class="review-items">${itemRows || '<p class="empty-state">No items yet.</p>'}</div>
      ${
        review.notes
          ? `<div class="chat-cart-summary-note"><span class="chat-cart-summary-note-label">Note:</span> ${escapeHtml(review.notes)}</div>`
          : ""
      }
      ${
        review.items.length > 0
          ? `<div class="chat-cart-summary-actions">
              <button type="button" class="chat-cart-summary-more-btn">Add more</button>
              <button type="button" class="chat-cart-summary-place-btn">Place order</button>
            </div>`
          : ""
      }
    `;

    block.querySelectorAll(".review-item-row").forEach((row) => {
      const lineId = row.dataset.lineId;
      const item = review.items.find((i) => String(i.lineId) === lineId);
      row
        .querySelector('[data-action="increase"]')
        .addEventListener("click", () => changeChatCartItemQuantity(lineId, item.quantity + 1, block));
      row
        .querySelector('[data-action="decrease"]')
        .addEventListener("click", () => changeChatCartItemQuantity(lineId, item.quantity - 1, block));
      row.querySelector('[data-action="change"]').addEventListener("click", () => {
        // Handed to the AI conversationally rather than reopening the add
        // sheet — a cart line can carry state (notes, an already-confirmed
        // size) the sheet doesn't round-trip, so asking what to change
        // avoids silently discarding any of that.
        const text = `I'd like to change my ${item.name}`;
        appendMessage("user", text);
        sendChatMessage(text);
      });
    });

    // "Add more" just gets out of the way — the cart summary itself isn't
    // a dead end, so there's nothing to navigate to, only focus to return
    // to the composer.
    block.querySelector(".chat-cart-summary-more-btn")?.addEventListener("click", () => {
      chatInput.focus();
    });

    const placeButton = block.querySelector(".chat-cart-summary-place-btn");
    if (placeButton) {
      placeButton.addEventListener("click", () => {
        disableStaleReplyOptions();
        checkoutStarted = true;
        hideOldViewCartChips();
        updateCartCount();
        sendQuickReply("Proceed to checkout", "Place order");
      });
    }
  } catch (err) {
    block.innerHTML = `<span class="chat-item-add-status chat-item-add-status--error">${escapeHtml(err.message)}</span>`;
  }
}

// Shared by every qty +/-/remove control inside an in-chat cart summary —
// reuses the same PATCH/DELETE endpoints as the Cart view's changeItemQuantity,
// then re-renders this block in place and keeps the sticky cart bar in sync.
async function changeChatCartItemQuantity(lineId, newQty, block) {
  try {
    if (newQty < 1) {
      await apiSend("DELETE", `/api/order/items/${lineId}`);
    } else {
      await apiSend("PATCH", `/api/order/items/${lineId}`, { quantity: newQty });
    }
    updateCartCount();
    await renderCartSummaryBlock(block);
    chatArea.scrollTop = chatArea.scrollHeight;
  } catch (err) {
    alert(err.message);
  }
}

function truncateWords(text, maxWords) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text || "";
  return `${words.slice(0, maxWords).join(" ")}…`;
}

// A shimmering placeholder the same shape/size as a real item card (see
// buildChatItemCard) — shown while item-card results are "loading" (see
// SKELETON_MIN_MS) so results never just pop into existence.
function buildSkeletonCard() {
  const card = document.createElement("div");
  card.className = "chat-compare-card chat-skeleton-card";
  card.innerHTML = `
    <div class="chat-compare-card-image chat-skeleton-shimmer"></div>
    <div class="chat-compare-card-details">
      <div class="chat-skeleton-line chat-skeleton-shimmer" style="width:70%;height:14px;"></div>
      <div class="chat-skeleton-line chat-skeleton-shimmer" style="width:95%;"></div>
      <div class="chat-skeleton-line chat-skeleton-shimmer" style="width:55%;"></div>
      <div class="chat-skeleton-pill chat-skeleton-shimmer"></div>
    </div>
  `;
  return card;
}

// Renders items returned by an item-listing/comparison tool as cards
// appended directly to the chat transcript — not the quick-reply strip —
// so previous turns' items stay visible in the scrollback instead of being
// replaced by the next turn's, and they never crowd the input area. Two
// cards per row (see .chat-item-list's grid), same portrait shape as a
// comparison card. Shows skeleton placeholders first (see buildSkeletonCard)
// for at least SKELETON_MIN_MS before swapping in the real cards.
async function appendItemList(items) {
  const skeletonList = document.createElement("div");
  skeletonList.className = "chat-item-list";
  for (let i = 0; i < items.length; i++) {
    skeletonList.appendChild(buildSkeletonCard());
  }
  chatArea.appendChild(skeletonList);
  chatArea.scrollTop = chatArea.scrollHeight;

  await sleep(SKELETON_MIN_MS);

  const list = document.createElement("div");
  list.className = "chat-item-list";
  for (const item of items) {
    list.appendChild(buildChatItemCard(item));
  }
  skeletonList.replaceWith(attachScrollHint(list));
  chatArea.scrollTop = chatArea.scrollHeight;
}

// Wraps a scrollable .chat-item-list with a fading, pulsing chevron hint on
// its right edge whenever there's more content to scroll to — the
// scrollbar itself is hidden (see .chat-item-list CSS), so without this
// nothing signals the row is scrollable at all. Hides itself once the
// customer has scrolled to the end.
function attachScrollHint(list) {
  const wrap = document.createElement("div");
  wrap.className = "chat-item-list-wrap";
  wrap.appendChild(list);

  const hint = document.createElement("div");
  hint.className = "chat-item-list-scroll-hint";
  hint.innerHTML =
    '<span class="chat-item-list-scroll-chevron">' +
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    "</span>";
  wrap.appendChild(hint);

  function updateHint() {
    const hasOverflow = list.scrollWidth > list.clientWidth + 4;
    const atEnd = list.scrollLeft + list.clientWidth >= list.scrollWidth - 4;
    hint.hidden = !hasOverflow || atEnd;
  }
  list.addEventListener("scroll", updateHint);
  updateHint();
  // Card photos loading in can grow scrollWidth after the initial layout
  // pass — check again shortly after so the hint doesn't stay hidden.
  setTimeout(updateHint, 300);

  return wrap;
}

// Renders exactly two items as a side-by-side "VS" comparison — the same
// portrait cards as appendItemList, plus a circular VS badge on the seam
// between them. highlights (from compare_items' comparisonHighlights) adds
// a "Best for" line under each card and a recommendation callout below —
// this is the substance of the comparison now, not a text paragraph, so the
// customer can read it at a glance instead of a wall of prose. Skeleton
// placeholders show first, same as appendItemList.
async function appendComparisonCards(items, highlights) {
  const skeletonWrap = document.createElement("div");
  skeletonWrap.className = "chat-compare-wrap";
  skeletonWrap.appendChild(buildSkeletonCard());
  const skeletonVs = document.createElement("span");
  skeletonVs.className = "chat-compare-vs";
  skeletonVs.textContent = "VS";
  skeletonWrap.appendChild(skeletonVs);
  skeletonWrap.appendChild(buildSkeletonCard());
  chatArea.appendChild(skeletonWrap);
  chatArea.scrollTop = chatArea.scrollHeight;

  await sleep(SKELETON_MIN_MS);

  const wrap = document.createElement("div");
  wrap.className = "chat-compare-wrap";

  wrap.appendChild(buildChatItemCard(items[0], highlights ? highlights.item1BestFor : null));

  const vs = document.createElement("span");
  vs.className = "chat-compare-vs";
  vs.textContent = "VS";
  wrap.appendChild(vs);

  wrap.appendChild(buildChatItemCard(items[1], highlights ? highlights.item2BestFor : null));

  skeletonWrap.replaceWith(wrap);

  if (highlights && highlights.recommendedItemName) {
    const callout = document.createElement("div");
    callout.className = "chat-compare-recommendation";
    callout.innerHTML =
      '<span class="chat-compare-recommendation-icon">★</span>' +
      '<div class="chat-compare-recommendation-text">' +
      '<span class="chat-compare-recommendation-title">RoboCap Recommends</span>' +
      `<span>Go for <strong>${escapeHtml(highlights.recommendedItemName)}</strong>${
        highlights.recommendationReason ? ` ${escapeHtml(highlights.recommendationReason)}` : ""
      }</span>` +
      "</div>";
    chatArea.appendChild(callout);
  }

  chatArea.scrollTop = chatArea.scrollHeight;
}

// Shared portrait card — photo on top, details below, Add control at the
// bottom — used both for plain item lists and for side-by-side comparisons
// so the two look identical apart from the VS badge.
// Small square-with-dot mark — the standard Indian veg/non-veg food symbol —
// used inline next to the item name instead of a text badge.
function dietaryIcon(isVeg) {
  const color = isVeg ? "#2a7a2a" : "#a0442a";
  return (
    `<svg class="dietary-icon" viewBox="0 0 16 16" width="12" height="12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img">` +
    `<title>${isVeg ? "Vegetarian" : "Non-vegetarian"}</title>` +
    `<rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="${color}" stroke-width="1.5"/>` +
    `<circle cx="8" cy="8" r="3.4" fill="${color}"/></svg>`
  );
}

function buildChatItemCard(item, bestFor) {
  const card = document.createElement("div");
  card.className = "chat-compare-card";

  // Every menu item is either non-veg or veg — non-veg is always tagged
  // explicitly, but veg items are sometimes only tagged "vegan"/
  // "gluten-free" without the literal "vegetarian" string, so treat
  // "not tagged non-vegetarian" as the veg signal rather than requiring
  // an exact "vegetarian" match.
  const isVeg = !(item.dietary && item.dietary.includes("non-vegetarian"));

  const badges = [];
  if (item.bestseller) badges.push('<span class="badge badge-bestseller">Bestseller</span>');
  if (item.spicy) badges.push('<span class="badge badge-spicy">🌶️ Spicy</span>');
  if (item.recommended) badges.push('<span class="badge badge-recommended">Recommended</span>');

  card.innerHTML = `
    <div class="chat-compare-card-image">
      ${iconSvg(item.image)}
      ${badges.length > 0 ? `<div class="chat-item-row-badges">${badges.join("")}</div>` : ""}
    </div>
    <div class="chat-compare-card-details">
      <div class="chat-item-row-top">
        <span class="chat-item-row-name">${dietaryIcon(isVeg)}${item.label}</span>
      </div>
      ${item.description ? `<p class="chat-item-row-desc">${truncateWords(item.description, 10)}</p>` : ""}
      ${
        bestFor
          ? `<p class="chat-item-row-best-for"><strong>Best for:</strong> ${escapeHtml(bestFor)}</p>`
          : ""
      }
      <div class="chat-item-row-action">
        ${item.price != null ? `<span class="chat-item-row-price">₹${Number(item.price).toFixed(0)}</span>` : ""}
      </div>
    </div>
  `;

  card.querySelector(".chat-item-row-action").appendChild(buildAddControl(item));
  return card;
}

// A per-row Add control — tapping Add opens the full customization sheet
// (see openItemCustomizeSheet) instead of an inline stepper, so size/
// add-on choices are made up front rather than needing an AI round-trip
// after the fact for anything but the simplest item.
function buildAddControl(item) {
  const wrap = document.createElement("div");
  wrap.className = "chat-item-add";

  function renderIdle() {
    wrap.innerHTML = "";
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "chat-item-add-button";
    addButton.textContent = "Add";
    addButton.addEventListener("click", () => openItemCustomizeSheet(item, wrap, renderIdle));
    wrap.appendChild(addButton);
  }

  renderIdle();
  return wrap;
}

// Actually places the order line (used by the customize sheet's Add
// button) — payload is whatever POST /api/order/items accepts beyond
// itemId (size, quantity, options, addOns). Status renders into the
// originating card's own .chat-item-add wrap, same as before the sheet
// existed, so the transcript still reads as "this card's item got added".
async function confirmChatItemAdd(item, payload, wrap, resetToIdle) {
  // Adding an item directly means the conversation has moved forward past
  // any earlier pending size/add-on/etc. prompt — those are now stale.
  disableStaleReplyOptions();
  wrap.innerHTML = '<span class="chat-item-add-status">Adding…</span>';
  try {
    const data = await apiSend("POST", "/api/order/items", { itemId: item.itemId, ...payload });
    if (data.needsClarification) {
      // The sheet already collects size/add-ons up front, so this should be
      // rare — fall back to the AI conversationally rather than get stuck.
      resetToIdle();
      appendMessage("user", item.value);
      sendChatMessage(item.value);
      return;
    }
    wrap.innerHTML =
      '<span class="chat-item-add-status chat-item-add-status--success">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      "<span>Added</span></span>";
    updateCartCount();
    // On the customer's first item this session, the backend attaches 1-2
    // pairing suggestions as item cards — pitch them by name so the message
    // reads like RoboCap actively suggesting a pair, not a generic
    // "anything else?" follow-up.
    const pairs = Array.isArray(data.quickReplies) ? data.quickReplies : [];
    const summary =
      pairs.length > 0
        ? `Added **${item.label}** to your cart! It goes really well with ${pairs
            .map((p) => `**${p.label}**`)
            .join(" or ")} — want to add one?`
        : `Added **${item.label}** to your cart. Would you like anything else, or are you ready to proceed with fulfillment?`;
    appendMessage("bot", summary);
    chatHistory.push({ role: "assistant", content: summary });
    if (pairs.length > 0) {
      appendItemList(pairs);
    }
    setTimeout(resetToIdle, 1800);
  } catch (err) {
    wrap.innerHTML = `<span class="chat-item-add-status chat-item-add-status--error">${escapeHtml(err.message)}</span>`;
    setTimeout(resetToIdle, 1800);
  }
}

// --- Item customization sheet -------------------------------------------
// Opened by tapping "Add" on a chat item card. Chat item cards only carry a
// slim shape (label/price/image — see buildItemQuickReplies in server.js),
// not sizes/options/addOnGroups, so this looks the full item up from
// state.menu (already loaded for the Menu tab, via the existing GET
// /api/menu — no new backend surface) by itemId. Submitting calls the same
// POST /api/order/items the Menu tab's own card and the old inline stepper
// used, just with size/options/addOns collected up front.
const itemSheetBackdrop = document.getElementById("itemSheetBackdrop");
const itemSheetHeader = document.getElementById("itemSheetHeader");
const itemSheetBody = document.getElementById("itemSheetBody");
const itemSheetFooter = document.getElementById("itemSheetFooter");

function closeItemSheet() {
  if (itemSheetBackdrop.hidden) return;
  itemSheetBackdrop.classList.remove("active");
  itemSheetBackdrop.classList.add("closing");
  const onEnd = (event) => {
    if (event.target !== itemSheetBackdrop) return;
    itemSheetBackdrop.removeEventListener("transitionend", onEnd);
    itemSheetBackdrop.hidden = true;
    itemSheetBackdrop.classList.remove("closing");
  };
  itemSheetBackdrop.addEventListener("transitionend", onEnd);
}

document.getElementById("itemSheetCloseButton").addEventListener("click", closeItemSheet);
// Tapping the dimmed backdrop itself (not the sheet card) cancels, same as
// the close button — only reachable when the click target is the backdrop
// element exactly, not something inside the sheet bubbling up.
itemSheetBackdrop.addEventListener("click", (event) => {
  if (event.target === itemSheetBackdrop) closeItemSheet();
});

async function openItemCustomizeSheet(chatItem, cardWrap, resetCardToIdle) {
  if (state.menu.length === 0) await loadMenu();
  const menuItem = state.menu.find((m) => m.id === chatItem.itemId);

  const sizes = menuItem && menuItem.sizes && menuItem.sizes.length > 0 ? menuItem.sizes : [{ name: null, price: chatItem.price }];
  const options = menuItem ? menuItem.options || [] : [];
  const addOnGroups = menuItem ? menuItem.addOnGroups || [] : [];

  let selectedSize = sizes[0].name;
  const selectedOptions = new Set();
  const selectedAddOns = new Set();
  let quantity = 1;

  function unitPrice() {
    const sizePrice = (sizes.find((s) => s.name === selectedSize) || sizes[0]).price;
    let total = sizePrice;
    for (const group of addOnGroups) {
      for (const opt of group.options) {
        if (selectedAddOns.has(opt.name)) total += opt.priceDelta || 0;
      }
    }
    return total;
  }

  function renderHeader() {
    itemSheetHeader.innerHTML = `
      <span class="item-sheet-photo">${iconSvg(chatItem.image)}</span>
      <div class="item-sheet-header-text">
        <div class="item-sheet-name">${escapeHtml(chatItem.label)}</div>
        ${chatItem.description ? `<p class="item-sheet-desc">${escapeHtml(chatItem.description)}</p>` : ""}
      </div>
      <div class="item-sheet-price">₹${unitPrice().toFixed(0)}</div>
    `;
  }

  function addOnBadgeText(group) {
    if (group.required) return `Required, choose ${group.min}${group.max > group.min ? `-${group.max}` : ""}`;
    if (group.min > 0) return `Min ${group.min}, up to ${group.max}`;
    return `Up to ${group.max}`;
  }

  function renderBody() {
    let html = "";

    if (sizes.length > 1 && sizes[0].name) {
      html += `
        <div class="item-sheet-section">
          <div class="item-sheet-section-title">
            <span>Select Type</span>
            <span class="item-sheet-badge item-sheet-badge--required">Choose any 1</span>
          </div>
          <div class="item-sheet-radio-list">
            ${sizes
              .map(
                (s) => `
              <label class="item-sheet-radio-row${s.name === selectedSize ? " item-sheet-radio-row--selected" : ""}">
                <span>${escapeHtml(s.name)}</span>
                <span class="item-sheet-radio-row-right">
                  <span class="item-sheet-row-price">₹${Number(s.price).toFixed(0)}</span>
                  <input type="radio" name="itemSheetSize" value="${escapeHtml(s.name)}" ${s.name === selectedSize ? "checked" : ""} />
                </span>
              </label>`
              )
              .join("")}
          </div>
        </div>
      `;
    }

    if (options.length > 0) {
      html += `
        <div class="item-sheet-section">
          <div class="item-sheet-section-title">
            <span>Customizations</span>
            <span class="item-sheet-badge">Optional</span>
          </div>
          <div class="item-sheet-checkbox-list">
            ${options
              .map(
                (name) => `
              <label class="item-sheet-checkbox-row">
                <span>${escapeHtml(name)}</span>
                <input type="checkbox" data-option="${escapeHtml(name)}" ${selectedOptions.has(name) ? "checked" : ""} />
              </label>`
              )
              .join("")}
          </div>
        </div>
      `;
    }

    for (const group of addOnGroups) {
      const chosenCount = group.options.filter((o) => selectedAddOns.has(o.name)).length;
      html += `
        <div class="item-sheet-section">
          <div class="item-sheet-section-title">
            <span>${escapeHtml(group.name)}</span>
            <span class="item-sheet-badge${group.required ? " item-sheet-badge--required" : ""}">${addOnBadgeText(group)}</span>
          </div>
          <div class="item-sheet-section-sub">
            <span>${chosenCount} of ${group.max} chosen</span>
            ${chosenCount > 0 ? `<button type="button" class="item-sheet-clear-btn" data-clear-group="${escapeHtml(group.name)}">Clear</button>` : ""}
          </div>
          <div class="item-sheet-checkbox-list">
            ${group.options
              .map(
                (opt) => `
              <label class="item-sheet-checkbox-row">
                <span>${escapeHtml(opt.name)}</span>
                <span class="item-sheet-checkbox-row-right">
                  ${opt.priceDelta > 0 ? `<span class="item-sheet-addon-price">+ ₹${Number(opt.priceDelta).toFixed(0)}</span>` : ""}
                  <input type="checkbox" data-addon="${escapeHtml(opt.name)}" data-group="${escapeHtml(group.name)}" ${
                  selectedAddOns.has(opt.name) ? "checked" : ""
                } />
                </span>
              </label>`
              )
              .join("")}
          </div>
        </div>
      `;
    }

    itemSheetBody.innerHTML =
      html || '<p class="item-sheet-empty">No customizations for this item — just pick a quantity.</p>';
    itemSheetBody.querySelector(".item-sheet-validation-error")?.remove();
    wireBodyEvents();
  }

  function wireBodyEvents() {
    itemSheetBody.querySelectorAll('input[name="itemSheetSize"]').forEach((input) => {
      input.addEventListener("change", () => {
        selectedSize = input.value;
        renderHeader();
        renderBody();
        renderFooter();
      });
    });
    itemSheetBody.querySelectorAll("input[data-option]").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) selectedOptions.add(input.dataset.option);
        else selectedOptions.delete(input.dataset.option);
      });
    });
    itemSheetBody.querySelectorAll("input[data-addon]").forEach((input) => {
      input.addEventListener("change", () => {
        const group = addOnGroups.find((g) => g.name === input.dataset.group);
        const chosenCount = group.options.filter((o) => selectedAddOns.has(o.name)).length;
        if (input.checked && chosenCount >= group.max) {
          // Already at the group's cap — reject this one instead of
          // silently bumping an earlier choice out.
          input.checked = false;
          return;
        }
        if (input.checked) selectedAddOns.add(input.dataset.addon);
        else selectedAddOns.delete(input.dataset.addon);
        renderHeader();
        renderBody();
        renderFooter();
      });
    });
    itemSheetBody.querySelectorAll("[data-clear-group]").forEach((button) => {
      button.addEventListener("click", () => {
        const group = addOnGroups.find((g) => g.name === button.dataset.clearGroup);
        for (const opt of group.options) selectedAddOns.delete(opt.name);
        renderHeader();
        renderBody();
        renderFooter();
      });
    });
  }

  // Every required add-on group must meet its minimum before submitting —
  // the sheet is meant to collect everything up front instead of leaning
  // on the AI's needsClarification fallback.
  function validate() {
    for (const group of addOnGroups) {
      const count = group.options.filter((o) => selectedAddOns.has(o.name)).length;
      if (group.required && count < group.min) {
        return `Choose at least ${group.min} from "${group.name}".`;
      }
    }
    return null;
  }

  function renderFooter() {
    itemSheetFooter.innerHTML = `
      <div class="item-sheet-qty">
        <button type="button" class="item-sheet-qty-btn" data-action="minus" aria-label="Decrease quantity">−</button>
        <span class="item-sheet-qty-value">${quantity}</span>
        <button type="button" class="item-sheet-qty-btn" data-action="plus" aria-label="Increase quantity">+</button>
      </div>
      <button type="button" class="item-sheet-add-btn" id="itemSheetAddBtn">Add · ₹${unitPrice().toFixed(0)}</button>
    `;
    itemSheetFooter.querySelector('[data-action="minus"]').addEventListener("click", () => {
      if (quantity > 1) {
        quantity -= 1;
        renderFooter();
      }
    });
    itemSheetFooter.querySelector('[data-action="plus"]').addEventListener("click", () => {
      if (quantity < 10) {
        quantity += 1;
        renderFooter();
      }
    });
    document.getElementById("itemSheetAddBtn").addEventListener("click", async () => {
      const error = validate();
      itemSheetBody.querySelector(".item-sheet-validation-error")?.remove();
      if (error) {
        const errorEl = document.createElement("p");
        errorEl.className = "item-sheet-validation-error";
        errorEl.textContent = error;
        itemSheetBody.appendChild(errorEl);
        itemSheetBody.scrollTop = itemSheetBody.scrollHeight;
        return;
      }
      closeItemSheet();
      await confirmChatItemAdd(
        chatItem,
        {
          size: sizes[0].name ? selectedSize : undefined,
          quantity,
          options: [...selectedOptions],
          addOns: [...selectedAddOns],
        },
        cardWrap,
        resetCardToIdle
      );
    });
  }

  renderHeader();
  renderBody();
  renderFooter();

  itemSheetBackdrop.hidden = false;
  void itemSheetBackdrop.offsetWidth;
  itemSheetBackdrop.classList.add("active");
}

// Conversation sent to the AI as context — {role: "user"|"assistant", content}.
// Starts empty; the seed bubbles are decorative and not real history.
const chatHistory = [];

// Once the customer taps "Proceed to checkout", jumping back to View Cart
// mid-fulfillment doesn't fit the flow — this suppresses the chip from here
// on until Start Over resets it.
let checkoutStarted = false;

function lockChatInput(locked) {
  chatInput.disabled = locked;
  sendButton.disabled = locked;
  micButton.disabled = locked;
  chatInput.hidden = locked;
  chatInputWrap.hidden = locked;
  sendButton.hidden = locked;
  micButton.hidden = locked || !SpeechRecognitionApi;
  orderLockedBanner.hidden = !locked;
}

const orderLockedSubtitle = document.getElementById("orderLockedSubtitle");
const orderLockedStats = document.getElementById("orderLockedStats");

// Fills the "order placed" card with only what actually exists — no
// fabricated ETA/kitchen-stage data (the order model has no such field; see
// confirmOrder in server.js). total/orderType come from the pre-confirm
// order snapshot (see sendChatMessage's orderBeforeThisTurn — the backend
// resets the order to empty the instant it confirms). The order id isn't in
// that snapshot (it's only generated during confirmation), but the
// confirmation reply text always states it verbatim ("Order #<uuid>"), so
// it's parsed out of there instead.
function populateOrderLockedBanner(order, replyText) {
  const orderTypeLabel = { pickup: "pickup", delivery: "delivery", dine_in: "dine-in" }[order && order.orderType] || "your order";
  orderLockedSubtitle.textContent = `South Indian Cafe is on it — ${orderTypeLabel}.`;
  const stats = [];
  // The AI paraphrases the confirmation freely (see confirmOrder's tool
  // result vs. the model's own final reply text) — it isn't guaranteed to
  // say "Order #<id>" verbatim, so match the order id's own UUID shape
  // instead of any particular surrounding wording.
  const orderIdMatch = (replyText || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (orderIdMatch) {
    stats.push(
      `<div class="order-locked-stat"><span class="order-locked-stat-label">Order</span><span class="order-locked-stat-value">#${orderIdMatch[0].slice(-6).toUpperCase()}</span></div>`
    );
  }
  if (order && order.total != null) {
    stats.push(
      `<div class="order-locked-stat"><span class="order-locked-stat-label">To pay</span><span class="order-locked-stat-value">${formatMoney(order.total)}</span></div>`
    );
  }
  orderLockedStats.innerHTML = stats.join("");
}

// Once an order is confirmed, every quick-reply/Add control still sitting
// in the scrollback from earlier turns is stale — tapping one would try to
// act on an order that's already been placed and reset. Disable them in
// place rather than removing them, so the transcript still reads correctly.
function disableChatHistoryInteractions() {
  chatArea
    .querySelectorAll(
      ".chat-reply-option, .chat-item-add-button, .chat-item-qty-stepper button, .chat-item-qty-confirm, .chat-cart-summary-place-btn, .chat-cart-summary-more-btn, .review-item-change, .chat-details-form-save, .chat-details-form-later"
    )
    .forEach((el) => {
      el.disabled = true;
    });
}

async function sendChatMessage(text) {
  chatInput.disabled = true;
  sendButton.disabled = true;
  const typingStartedAt = Date.now();
  showTypingIndicator();

  // The order this turn might confirm is still state.order right now — the
  // backend resets it to empty the instant it's confirmed (so the next
  // order starts fresh), and apiSend below overwrites state.order with that
  // already-reset order before this function ever sees the response. Snap
  // a copy now so populateOrderLockedBanner has real total/orderType to
  // show, not the reset order's null/₹0 (see populateOrderLockedBanner).
  const orderBeforeThisTurn = state.order ? { ...state.order } : null;

  try {
    const data = await apiSend("POST", "/api/chat", { message: text, history: chatHistory });
    chatHistory.push({ role: "user", content: text });
    chatHistory.push({ role: "assistant", content: data.reply });
    const speakText = data.orderJustConfirmed
      ? "Your order is confirmed. It will be ready shortly."
      : data.isOrderSummary
      ? "Here is your final order summary. Shall I place the order?"
      : data.reply;
    // Start the TTS request now, during the (purely cosmetic) typing-loader
    // pause below, instead of after the message appears — by the time the
    // bubble renders, the audio's already been buffering for that pause's
    // duration, so playback starts right on the message instead of a beat
    // after it.
    loadSpeech(speakText);
    // Every reply pauses on the typing loader for at least MIN_TYPING_MS —
    // a fast response would otherwise flash the indicator for a few ms,
    // which reads as broken rather than "RoboCap thought about it".
    const typingElapsed = Date.now() - typingStartedAt;
    if (typingElapsed < MIN_TYPING_MS) await sleep(MIN_TYPING_MS - typingElapsed);
    removeTypingIndicator();
    appendMessage("bot", data.reply, { speakText, speechPreloaded: true });

    const isItemList = Array.isArray(data.quickReplies) && data.quickReplies.length > 0 && typeof data.quickReplies[0] === "object";
    if (isItemList) {
      if (data.isComparison && data.quickReplies.length === 2) {
        appendComparisonCards(data.quickReplies, data.comparisonHighlights);
      } else {
        appendItemList(data.quickReplies);
      }
    } else if (Array.isArray(data.quickReplies) && data.quickReplies.length > 0) {
      appendReplyOptions(data.quickReplies);
    }
    // Tool calls this turn may have changed the order — reflect it everywhere.
    updateCartCount();

    if (data.orderJustConfirmed) {
      populateOrderLockedBanner(orderBeforeThisTurn, data.reply);
      lockChatInput(true);
      disableChatHistoryInteractions();
    }
  } catch (err) {
    // Never surface the raw error (network failure, AI service down, a
    // malformed response) — the customer doesn't need to know why, just
    // that something went wrong and how to move past it.
    removeTypingIndicator();
    appendChatError(text);
  } finally {
    if (!orderLockedBanner.hidden) return;
    chatInput.disabled = false;
    sendButton.disabled = false;
    // No .focus() here — on mobile that pops the keyboard open right after
    // every reply. The input should only get focus (and the keyboard) when
    // the customer deliberately taps it themselves.
  }
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  // Typing past a pending clarification chip (instead of tapping it) still
  // moves the conversation forward — that chip is now stale either way.
  disableStaleReplyOptions();
  appendMessage("user", text);
  chatInput.value = "";
  sendChatMessage(text);
});

// Ensure Enter reliably sends the message across browsers/input methods.
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

startOverButton.addEventListener("click", () => {
  lockChatInput(false);
  chatInput.value = "";
  // A fresh order shouldn't drag the previous order's entire conversation
  // into the AI's context on every future turn.
  chatHistory.length = 0;
  checkoutStarted = false;
  appendMessage("bot", "Ready when you are — what would you like today?");
  appendReplyOptions(WELCOME_QUICK_REPLIES, { skipIcon: true });
});

// "Track it" — real navigation to the customer's own order history (the
// closest thing to order tracking the backend actually exposes; there's no
// kitchen-stage/ETA data to show a live progress stepper against).
document.getElementById("trackOrderButton").addEventListener("click", () => {
  closeChatWindow("orders");
});

// --- Speech-to-text (mic button) ------------------------------------------
// Uses the browser's built-in Web Speech API — no server involved, no new
// dependency. Only shown if the browser actually supports it. Shows the
// live transcript in the input box as the customer speaks (interim
// results). After 2s of no new speech, auto-stops and sends — a manual tap
// to stop instead leaves the text in the box for review without sending,
// since a deliberate stop means the customer wants to edit first.
const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognitionApi) {
  const recognition = new SpeechRecognitionApi();
  recognition.lang = "en-IN";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  // Android's SpeechRecognition (the OS-level engine, not desktop Chrome's)
  // doesn't support continuous mode properly — it periodically re-emits
  // already-finalized text as if it were new, which is what causes words to
  // repeat 2-3x. Desktop Chrome's continuous mode doesn't have this bug, so
  // only Android gets the one-shot-session-plus-auto-restart workaround
  // below; everywhere else keeps continuous mode as before.
  const isAndroid = /Android/i.test(navigator.userAgent);
  recognition.continuous = !isAndroid;
  let listening = false;
  // True only when the customer explicitly tapped the mic to stop — tells
  // the "end" handler not to auto-restart an Android session that's
  // supposed to actually be over.
  let manualStop = false;
  let autoSendPending = false;
  let silenceTimer = null;
  // Accumulates only text the engine has already finalized. Re-summing
  // event.results[0..length) from scratch on every "result" event (the
  // previous approach) is what caused words to repeat 2-3x: in continuous
  // mode Chrome periodically re-segments the audio and can re-emit an
  // already-finalized span as if it were new. Tracking our own running
  // total and only appending genuinely-final segments once sidesteps that.
  let finalTranscript = "";
  const SILENCE_AUTO_SEND_MS = 2000;

  micButton.hidden = false;

  function startSendCountdown() {
    sendButton.classList.remove("counting-down");
    void sendButton.offsetWidth; // force reflow so the CSS animation restarts from 0 each time
    sendButton.classList.add("counting-down");
  }

  function cancelSendCountdown() {
    sendButton.classList.remove("counting-down");
  }

  recognition.addEventListener("result", (event) => {
    let interimTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const segment = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += segment;
      } else {
        interimTranscript += segment;
      }
    }
    chatInput.value = (finalTranscript + interimTranscript).trim();
    syncPlaceholderVisibility();

    clearTimeout(silenceTimer);
    startSendCountdown();
    silenceTimer = setTimeout(() => {
      autoSendPending = true;
      recognition.stop();
    }, SILENCE_AUTO_SEND_MS);
  });

  recognition.addEventListener("end", () => {
    // Android ends each session on its own short internal pause even with
    // continuous off — restart immediately to keep listening through our
    // own silence window, unless the customer stopped it themselves or the
    // silence timer already decided to auto-send.
    if (isAndroid && listening && !autoSendPending && !manualStop) {
      try {
        recognition.start();
        return;
      } catch (err) {
        // Fall through and fully stop below.
      }
    }

    listening = false;
    micButton.classList.remove("mic-listening");
    clearTimeout(silenceTimer);
    cancelSendCountdown();

    if (autoSendPending) {
      autoSendPending = false;
      if (chatInput.value.trim()) chatForm.requestSubmit();
    }
    // No .focus() here either — same "don't pop the keyboard uninvited" reasoning.
  });

  recognition.addEventListener("error", (event) => {
    // "no-speech"/"aborted" are routine on Android's short-session model
    // (e.g. the customer paused before speaking) — recoverable, so let the
    // "end" event that always follows decide whether to restart instead of
    // tearing down state here.
    if (isAndroid && (event.error === "no-speech" || event.error === "aborted")) {
      return;
    }
    listening = false;
    autoSendPending = false;
    manualStop = false;
    clearTimeout(silenceTimer);
    cancelSendCountdown();
    micButton.classList.remove("mic-listening");
  });

  micButton.addEventListener("click", () => {
    if (listening) {
      autoSendPending = false;
      manualStop = true;
      clearTimeout(silenceTimer);
      cancelSendCountdown();
      recognition.stop();
      return;
    }
    // If the text input still has focus (keyboard open), tapping the mic
    // right away can race with the keyboard-dismiss/blur — on some mobile
    // browsers that leaves the speech engine in a state where start()
    // throws InvalidStateError instead of actually starting. Drop focus
    // first, then guard start() so a throw doesn't leave the button stuck
    // showing "listening" while nothing is actually happening.
    chatInput.blur();
    listening = true;
    manualStop = false;
    finalTranscript = "";
    micButton.classList.add("mic-listening");
    try {
      recognition.start();
    } catch (err) {
      listening = false;
      micButton.classList.remove("mic-listening");
    }
  });
}

// ---------------------------------------------------------------------
// Guided ordering UI — real backend calls, shares state with SmartOrder.
// ---------------------------------------------------------------------

const state = {
  sessionId: sessionStorage.getItem(SESSION_STORAGE_KEY) || null,
  order: null,
  menu: [],
  previousMainTab: "menu",
};

function saveSessionId(id) {
  if (id && id !== state.sessionId) {
    state.sessionId = id;
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  }
}

async function apiGet(path) {
  // Base against window.location so this works with a relative (same-origin)
  // API_BASE, not just an absolute one — new URL() throws otherwise.
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (state.sessionId) url.searchParams.set("sessionId", state.sessionId);

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed.");

  if (data.sessionId) saveSessionId(data.sessionId);
  if (data.order) state.order = data.order;
  return data;
}

async function apiSend(method, path, body = {}) {
  const payload = { ...body };
  if (state.sessionId) payload.sessionId = state.sessionId;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed.");

  if (data.sessionId) saveSessionId(data.sessionId);
  if (data.order) state.order = data.order;
  return data;
}

function formatMoney(amount) {
  return `₹${Number(amount).toFixed(2)}`;
}

// --- Tabs + pushed views ----------------------------------------------

const tabBar = document.getElementById("tabBar");
const tabButtons = tabBar.querySelectorAll(".tab-button");
const allPanels = document.querySelectorAll(".tab-panel");
const mainHeader = document.getElementById("mainHeader");
const mainTabNames = ["menu", "orders"];

function showTab(name) {
  state.previousMainTab = name;
  allPanels.forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  tabBar.hidden = false;
  // RoboCap's overlay hides this in favor of its own header — every other
  // tab/view keeps it visible.
  mainHeader.hidden = false;

  if (name === "menu" && state.menu.length === 0) loadMenu();
  if (name === "orders") loadOrderHistory();
  updateCartCount();
  updateRobocapFloaterVisibility();
}

// The welcome message + starter chips aren't rendered until the chat
// overlay is actually opened for the first time (see showView) — a brief
// typing loader plays first, so landing on the chat window feels like
// RoboCap is "waking up" rather than a chat that was already sitting there
// fully formed. Guarded so it only ever plays once per page load.
let chatWelcomeShown = false;
function showChatWelcome() {
  if (chatWelcomeShown) return;
  chatWelcomeShown = true;
  showTypingIndicator();
  setTimeout(() => {
    removeTypingIndicator();
    appendMessage("bot", "Vanakkam! My name is **RoboCap**! Your virtual Captain. How can I help you today?");
    appendReplyOptions(WELCOME_QUICK_REPLIES, { skipIcon: true });
  }, 1100);
}

// First-open-only splash (see .chat-splash in style.css) — an animated
// gradient mesh + "Hey there!" greeting shown once, in front of the real
// chat window, before handing off to showChatWelcome's usual typing
// indicator + "Vanakkam!" flow. Purely a one-time pre-roll: nothing about
// the existing chat-open flow changes once this finishes (or is skipped).
// Plays for CHAT_SPLASH_MS, or ends immediately if the customer taps
// "Start chatting" (see chatSplashSkipButton below) instead of waiting.
const chatSplash = document.getElementById("chatSplash");
const chatSplashSkipButton = document.getElementById("chatSplashSkipButton");
let chatSplashPlayed = false;
let chatSplashTimer = null;
const CHAT_SPLASH_MS = 10000;

function playChatSplash(onDone) {
  chatSplashPlayed = true;
  chatSplash.hidden = false;
  // Force layout so the .active class below actually transitions in
  // instead of the browser coalescing hidden->active into one paint.
  void chatSplash.offsetWidth;
  chatSplash.classList.add("active");

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    if (chatSplashTimer) {
      clearTimeout(chatSplashTimer);
      chatSplashTimer = null;
    }
    chatSplash.classList.remove("active");
    chatSplash.classList.add("leaving");
    const onTransitionEnd = (event) => {
      if (event.target !== chatSplash) return;
      chatSplash.removeEventListener("transitionend", onTransitionEnd);
      chatSplash.hidden = true;
      chatSplash.classList.remove("leaving");
      onDone();
    };
    chatSplash.addEventListener("transitionend", onTransitionEnd);
  }

  chatSplashTimer = setTimeout(finish, CHAT_SPLASH_MS);
  // Reassigning (not addEventListener) so a second playChatSplash call —
  // shouldn't happen given the chatSplashPlayed guard, but kept safe —
  // can't stack duplicate handlers.
  chatSplashSkipButton.onclick = finish;
}

// Bails out of a still-playing splash cleanly (see closeChatWindow) —
// otherwise its pending timer/listener could still fire after the chat
// window itself has already closed.
function cancelChatSplash() {
  if (chatSplashTimer) {
    clearTimeout(chatSplashTimer);
    chatSplashTimer = null;
  }
  chatSplash.hidden = true;
  chatSplash.classList.remove("active", "leaving");
}

document.getElementById("chatSplashCloseButton").addEventListener("click", closeChatWindow);

function showView(name) {
  allPanels.forEach((panel) => panel.classList.toggle("active", panel.id === `view-${name}`));
  tabBar.hidden = true;
  // The RoboCap overlay is a "new window" with its own header — Cart and
  // Checkout are lighter pushed views that keep the main header above them.
  mainHeader.hidden = name === "chat";
  updateCartCount();
  updateRobocapFloaterVisibility();
  if (name === "chat") {
    if (!chatSplashPlayed) {
      playChatSplash(showChatWelcome);
    } else {
      showChatWelcome();
    }
  }
}

tabBar.addEventListener("click", (event) => {
  const button = event.target.closest(".tab-button");
  if (button) showTab(button.dataset.tab);
});

document.getElementById("cartBackButton").addEventListener("click", () => showTab(state.previousMainTab));
document.getElementById("checkoutBackButton").addEventListener("click", () => showView("cart"));

const floatingCartButton = document.getElementById("floatingCartButton");
const floatingCartCount = document.getElementById("floatingCartCount");

floatingCartButton.addEventListener("click", () => {
  refreshCartView();
  showView("cart");
});

const robocapFloater = document.getElementById("robocapFloater");
const viewChatEl = document.getElementById("view-chat");

// Anchors the chat window's grow-in animation (see #view-chat.active in
// style.css) to wherever the floater actually is right now, so the window
// visibly opens out of the bubble instead of just fading in centered.
function setChatOriginFromFloater() {
  const appEl = document.querySelector(".chat-app");
  const appRect = appEl.getBoundingClientRect();
  const floaterRect = robocapFloater.getBoundingClientRect();
  const originX = ((floaterRect.left + floaterRect.width / 2 - appRect.left) / appRect.width) * 100;
  const originY = ((floaterRect.top + floaterRect.height / 2 - appRect.top) / appRect.height) * 100;
  viewChatEl.style.setProperty("--chat-origin-x", `${originX}%`);
  viewChatEl.style.setProperty("--chat-origin-y", `${originY}%`);
}

function openChatFromFloater() {
  setChatOriginFromFloater();
  showView("chat");
}

// Plays the shrink-back-into-the-floater animation (the reverse of
// #view-chat.active's grow-in) before actually switching away from the
// chat view — without this, closing would just snap instantly instead of
// visibly returning to the bubble.
function closeChatWindow(destinationTab = "menu") {
  cancelChatSplash();
  viewChatEl.classList.add("closing");
  const onAnimationEnd = () => {
    viewChatEl.classList.remove("closing");
    viewChatEl.removeEventListener("animationend", onAnimationEnd);
    showTab(destinationTab);
  };
  viewChatEl.addEventListener("animationend", onAnimationEnd);
}

// Draggable RoboCap bubble — Pointer Events cover mouse/touch/pen through
// one code path. Repositions via left/top (switching off the CSS default
// right/top the first time it's dragged), clamped to .chat-app's own
// bounding box so it can never be dragged outside the visible app frame —
// the same frame the floating cart pill and categories button already
// live in. A tap (negligible pointer movement) opens the chat overlay; a
// real drag just leaves it at the new spot.
function initRobocapFloater() {
  const appEl = document.querySelector(".chat-app");
  const DRAG_THRESHOLD = 6;
  let dragging = false;
  let startClientX = 0;
  let startClientY = 0;
  let startLeft = 0;
  let startTop = 0;
  let moved = 0;

  robocapFloater.addEventListener("pointerdown", (event) => {
    const appRect = appEl.getBoundingClientRect();
    const floaterRect = robocapFloater.getBoundingClientRect();
    dragging = true;
    moved = 0;
    startClientX = event.clientX;
    startClientY = event.clientY;
    startLeft = floaterRect.left - appRect.left;
    startTop = floaterRect.top - appRect.top;
    // Can throw (NotFoundError) in edge cases where the browser doesn't
    // consider this pointerId "active" yet — capture is a nice-to-have
    // (keeps the drag tracking even if the pointer leaves the button's
    // bounds), not a requirement, so failing silently is fine.
    try {
      robocapFloater.setPointerCapture(event.pointerId);
    } catch (err) {
      // ignore
    }
    robocapFloater.classList.add("dragging");
  });

  robocapFloater.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - startClientX;
    const dy = event.clientY - startClientY;
    moved = Math.max(moved, Math.hypot(dx, dy));

    const appRect = appEl.getBoundingClientRect();
    // Never let the bubble sit on or above the Menu/Orders tab bar — the
    // top of its drag range is the tab bar's own bottom edge, not the app
    // frame's top.
    const minTop = tabBar.getBoundingClientRect().bottom - appRect.top;
    const maxLeft = appRect.width - robocapFloater.offsetWidth;
    const maxTop = appRect.height - robocapFloater.offsetHeight;
    const newLeft = Math.min(Math.max(startLeft + dx, 0), Math.max(maxLeft, 0));
    const newTop = Math.min(Math.max(startTop + dy, minTop), Math.max(maxTop, minTop));

    robocapFloater.style.right = "auto";
    robocapFloater.style.left = `${newLeft}px`;
    robocapFloater.style.top = `${newTop}px`;
  });

  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    robocapFloater.classList.remove("dragging");
    try {
      if (robocapFloater.hasPointerCapture(event.pointerId)) {
        robocapFloater.releasePointerCapture(event.pointerId);
      }
    } catch (err) {
      // ignore
    }
    if (moved < DRAG_THRESHOLD) {
      openChatFromFloater();
      return;
    }
    // A real drag never leaves the bubble floating mid-screen — it sticks
    // to whichever side (left/right) its center ended up closer to, same
    // as a typical chat-head bubble.
    const appRect = appEl.getBoundingClientRect();
    const margin = 1;
    const floaterWidth = robocapFloater.offsetWidth;
    const currentLeft = parseFloat(robocapFloater.style.left) || 0;
    const centerX = currentLeft + floaterWidth / 2;
    const snapLeft = centerX < appRect.width / 2 ? margin : appRect.width - floaterWidth - margin;
    robocapFloater.style.left = `${snapLeft}px`;
  }

  robocapFloater.addEventListener("pointerup", endDrag);
  robocapFloater.addEventListener("pointercancel", endDrag);

  // The CSS default `top` is a fixed guess — correct it once up front in
  // case the tab bar renders taller than that on this device, so the
  // bubble never starts out sitting on top of it.
  const appRect = appEl.getBoundingClientRect();
  const minTop = tabBar.getBoundingClientRect().bottom - appRect.top;
  const floaterRect = robocapFloater.getBoundingClientRect();
  const currentTop = floaterRect.top - appRect.top;
  if (currentTop < minTop) {
    robocapFloater.style.top = `${minTop + 12}px`;
  }
}
initRobocapFloater();

function updateCartCount() {
  const count = state.order ? state.order.items.reduce((sum, i) => sum + i.quantity, 0) : 0;
  floatingCartCount.textContent = String(count);
  // The floating pill is a Menu/Orders-only affordance now — on the chat
  // tab, "View Cart" is a chat-native reply option instead (see
  // maybeOfferViewCart/appendReplyOptions) so it stays part of the
  // conversation rather than jumping to the separate Cart view.
  const onFloatingCartTab = ["menu", "orders"].some((t) => document.getElementById(`tab-${t}`).classList.contains("active"));
  floatingCartButton.hidden = count === 0 || !onFloatingCartTab;

  // The floating pill is position:absolute and sits on top of the chat
  // transcript — pad the scroll area so the last message can still scroll
  // fully into view above it instead of being covered.
  chatArea.classList.toggle("chat-area--fab-padding", !floatingCartButton.hidden);
  updateComposerCartBadge(count);
}

const composerCartBadge = document.getElementById("composerCartBadge");

// Item-count badge on the composer's cart icon — replaces the old sticky
// "View Cart" bar (redundant with this icon, which is always visible
// anyway) as the at-a-glance cart indicator inside the chat window.
function updateComposerCartBadge(count) {
  const itemCount = count != null ? count : state.order ? state.order.items.reduce((sum, i) => sum + i.quantity, 0) : 0;
  composerCartBadge.hidden = itemCount === 0;
  if (itemCount > 0) composerCartBadge.textContent = itemCount > 99 ? "99+" : String(itemCount);
}

// Composer's cart icon — opens the same in-chat cart summary the "View
// Cart" chip already offers (see appendCartSummary).
document.getElementById("composerCartButton").addEventListener("click", () => {
  appendCartSummary();
});

// The RoboCap floater is a Menu/Orders-only affordance, same rule as the
// floating cart pill — hidden while the chat overlay itself (or Cart/
// Checkout) is open, since there's nothing useful for it to open onto.
function updateRobocapFloaterVisibility() {
  const onMainTab = ["menu", "orders"].some((t) => document.getElementById(`tab-${t}`).classList.contains("active"));
  robocapFloater.hidden = !onMainTab;
}

// --- Menu tab -------------------------------------------------------------

const menuList = document.getElementById("menuList");
const categoriesFloatButton = document.getElementById("categoriesFloatButton");
const categoriesPopup = document.getElementById("categoriesPopup");

async function loadMenu() {
  menuList.innerHTML = '<p class="empty-state">Loading menu...</p>';
  try {
    const data = await apiGet("/api/menu");
    state.menu = data.items || [];
    renderMenu();
  } catch (err) {
    menuList.innerHTML = '<p class="empty-state">Could not load the menu. Is the backend running?</p>';
  }
}

function categorySlug(category) {
  return `menu-category-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function renderMenu() {
  menuList.innerHTML = "";

  const categories = [...new Set(state.menu.map((item) => item.category))];
  for (const category of categories) {
    const heading = document.createElement("div");
    heading.className = "menu-category";
    heading.id = categorySlug(category);
    heading.textContent = category;
    menuList.appendChild(heading);

    for (const item of state.menu.filter((i) => i.category === category)) {
      menuList.appendChild(buildMenuItemCard(item));
    }
  }

  renderCategoriesPopup(categories);
}

// Small floating button on the Menu tab that pops up a jump-list of
// categories — handy once the menu is long enough to require scrolling.
function renderCategoriesPopup(categories) {
  categoriesPopup.innerHTML = "";
  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = category;
    button.addEventListener("click", () => {
      document.getElementById(categorySlug(category)).scrollIntoView({ behavior: "smooth", block: "start" });
      categoriesPopup.hidden = true;
    });
    categoriesPopup.appendChild(button);
  }
  categoriesFloatButton.hidden = categories.length === 0;
}

categoriesFloatButton.addEventListener("click", () => {
  categoriesPopup.hidden = !categoriesPopup.hidden;
});

function buildMenuItemCard(item) {
  const card = document.createElement("div");
  card.className = "menu-item-card";

  const priceRange =
    item.sizes.length === 1
      ? formatMoney(item.sizes[0].price)
      : `${formatMoney(Math.min(...item.sizes.map((s) => s.price)))}–${formatMoney(Math.max(...item.sizes.map((s) => s.price)))}`;

  const header = document.createElement("div");
  header.className = "menu-item-top";
  header.innerHTML = `
    <span class="menu-item-icon">${iconSvg(item.image)}</span>
    <div class="menu-item-main">
      <div class="menu-item-header">
        <span class="menu-item-name">${item.name}</span>
        <span class="menu-item-price">${priceRange}</span>
      </div>
      <p class="menu-item-description">${item.description}</p>
      ${!item.available ? '<span class="menu-item-unavailable">Sold out</span>' : ""}
    </div>
  `;
  card.appendChild(header);

  if (!item.available) return card;

  const controls = document.createElement("div");
  controls.className = "menu-item-controls";

  let sizeSelect;
  if (item.sizes.length > 1) {
    sizeSelect = document.createElement("select");
    sizeSelect.className = "menu-item-size";
    for (const size of item.sizes) {
      const option = document.createElement("option");
      option.value = size.name;
      option.textContent = `${size.name} — ${formatMoney(size.price)}`;
      sizeSelect.appendChild(option);
    }
    controls.appendChild(sizeSelect);
  }

  let optionCheckboxes = [];
  if (item.options.length > 0) {
    const optionsWrap = document.createElement("div");
    optionsWrap.className = "menu-item-options";
    for (const optionName of item.options) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = optionName;
      optionCheckboxes.push(checkbox);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(` ${optionName}`));
      optionsWrap.appendChild(label);
    }
    controls.appendChild(optionsWrap);
  }

  // Add-on groups: mandatory ones are visually flagged; all are checkboxes
  // client-side (the backend enforces min/max and will ask again if a
  // required group isn't satisfied).
  let addOnCheckboxes = [];
  for (const group of item.addOnGroups || []) {
    const groupWrap = document.createElement("div");
    groupWrap.className = "menu-item-addon-group";
    const label = document.createElement("div");
    label.className = "menu-item-addon-group-label";
    label.textContent = `${group.name}${group.required ? " (required)" : " (optional)"}`;
    groupWrap.appendChild(label);

    for (const opt of group.options) {
      const optLabel = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = opt.name;
      addOnCheckboxes.push(checkbox);
      optLabel.appendChild(checkbox);
      optLabel.appendChild(document.createTextNode(` ${opt.name}${opt.priceDelta > 0 ? ` (+${formatMoney(opt.priceDelta)})` : ""}`));
      groupWrap.appendChild(optLabel);
    }
    controls.appendChild(groupWrap);
  }

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = "Add to order";
  addButton.addEventListener("click", async () => {
    addButton.disabled = true;
    try {
      const data = await apiSend("POST", "/api/order/items", {
        itemId: item.id,
        size: sizeSelect ? sizeSelect.value : undefined,
        options: optionCheckboxes.filter((c) => c.checked).map((c) => c.value),
        addOns: addOnCheckboxes.filter((c) => c.checked).map((c) => c.value),
      });
      if (data.needsClarification) {
        flashButton(addButton, "Choose add-ons first", true);
      } else {
        updateCartCount();
        flashButton(addButton, "Added!");
      }
    } catch (err) {
      flashButton(addButton, err.message, true);
    } finally {
      addButton.disabled = false;
    }
  });
  controls.appendChild(addButton);

  card.appendChild(controls);
  return card;
}

function flashButton(button, text, isError) {
  const original = button.textContent;
  button.textContent = text;
  button.classList.toggle("button-error", Boolean(isError));
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove("button-error");
  }, 1800);
}

// --- Cart view --------------------------------------------------------

const cartItems = document.getElementById("cartItems");
const cartTotals = document.getElementById("cartTotals");
const orderNotesInput = document.getElementById("orderNotesInput");
const saveOrderNotesButton = document.getElementById("saveOrderNotesButton");
const proceedToCheckoutButton = document.getElementById("proceedToCheckoutButton");
const cartCheckoutBar = document.getElementById("cartCheckoutBar");
const cartCheckoutBarTotal = document.getElementById("cartCheckoutBarTotal");
const promotionsSection = document.getElementById("promotionsSection");
const promotionsList = document.getElementById("promotionsList");
const recommendationsSection = document.getElementById("recommendationsSection");
const recommendationsList = document.getElementById("recommendationsList");

async function refreshCartView() {
  try {
    if (!state.order) await apiGet("/api/order/summary");
  } catch (err) {
    // fall through and render whatever we have
  }
  renderCart();
  loadPromotions();
  loadRecommendations();
}

function renderCart() {
  const order = state.order;
  updateCartCount();

  if (!order || order.items.length === 0) {
    cartItems.innerHTML = '<p class="empty-state">Your cart is empty.</p>';
    cartTotals.hidden = true;
    cartCheckoutBar.hidden = true;
    return;
  }

  cartCheckoutBar.hidden = false;
  cartCheckoutBarTotal.textContent = formatMoney(order.total);
  orderNotesInput.value = order.notes || "";

  cartItems.innerHTML = "";
  for (const item of order.items) {
    const row = document.createElement("div");
    row.className = "cart-item";
    const customizations = item.options.length > 0 ? `, ${item.options.join(", ")}` : "";
    const addOnNames = (item.addOns || []).map((a) => a.name);
    const addOnNote = addOnNames.length > 0 ? `, ${addOnNames.join(", ")}` : "";
    row.innerHTML = `
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name} (${item.size}${customizations}${addOnNote})</div>
        <div class="cart-item-price">${formatMoney(item.unitPrice)} each</div>
      </div>
      <div class="cart-item-controls">
        <button type="button" class="qty-btn" data-action="decrease">−</button>
        <span class="qty-value">${item.quantity}</span>
        <button type="button" class="qty-btn" data-action="increase">+</button>
        <button type="button" class="remove-btn" data-action="remove">Remove</button>
      </div>
      <input type="text" class="cart-item-note" placeholder="Add a note for this item..." value="${item.notes ? item.notes.replace(/"/g, "&quot;") : ""}" />
    `;

    row.querySelector('[data-action="increase"]').addEventListener("click", () =>
      changeItemQuantity(item.lineId, item.quantity + 1)
    );
    row.querySelector('[data-action="decrease"]').addEventListener("click", () =>
      changeItemQuantity(item.lineId, item.quantity - 1)
    );
    row.querySelector('[data-action="remove"]').addEventListener("click", () => removeItem(item.lineId));
    row.querySelector(".cart-item-note").addEventListener("blur", (e) => saveItemNote(item.lineId, e.target.value));

    cartItems.appendChild(row);
  }

  cartTotals.hidden = false;
  const parts = [`Subtotal: ${formatMoney(order.subtotal)}`];
  if (order.discount > 0) parts.push(`Discount: -${formatMoney(order.discount)}`);
  parts.push(`Tax: ${formatMoney(order.tax)}`);
  if (order.deliveryFee > 0) parts.push(`Delivery fee: ${formatMoney(order.deliveryFee)}`);
  parts.push(`<strong>Total: ${formatMoney(order.total)}</strong>`);
  cartTotals.innerHTML = parts.join("<br />");
}

async function changeItemQuantity(lineId, newQty) {
  try {
    if (newQty < 1) {
      await apiSend("DELETE", `/api/order/items/${lineId}`);
    } else {
      await apiSend("PATCH", `/api/order/items/${lineId}`, { quantity: newQty });
    }
    renderCart();
    loadPromotions();
    loadRecommendations();
  } catch (err) {
    alert(err.message);
  }
}

async function removeItem(lineId) {
  try {
    await apiSend("DELETE", `/api/order/items/${lineId}`);
    renderCart();
    loadPromotions();
    loadRecommendations();
  } catch (err) {
    alert(err.message);
  }
}

async function saveItemNote(lineId, notes) {
  try {
    await apiSend("PATCH", `/api/order/items/${lineId}`, { notes });
  } catch (err) {
    alert(err.message);
  }
}

saveOrderNotesButton.addEventListener("click", async () => {
  try {
    await apiSend("POST", "/api/order/notes", { notes: orderNotesInput.value });
    flashButton(saveOrderNotesButton, "Saved!");
  } catch (err) {
    alert(err.message);
  }
});

proceedToCheckoutButton.addEventListener("click", () => showView("checkout"));

async function loadPromotions() {
  try {
    const data = await apiGet("/api/promotions/eligible");
    const eligible = data.eligiblePromotions || [];
    if (eligible.length === 0) {
      promotionsSection.hidden = true;
      return;
    }
    promotionsSection.hidden = false;
    promotionsList.innerHTML = "";
    for (const promo of eligible) {
      const row = document.createElement("div");
      row.className = "promo-row";
      const applied = state.order && state.order.promotionId === promo.id;
      row.innerHTML = `
        <div>
          <div class="promo-name">${promo.name}</div>
          <div class="promo-rule">${promo.rule}</div>
        </div>
      `;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = applied ? "Applied" : "Apply";
      button.disabled = applied;
      button.addEventListener("click", async () => {
        try {
          await apiSend("POST", "/api/order/promotion", { promotionId: promo.id });
          renderCart();
          loadPromotions();
        } catch (err) {
          alert(err.message);
        }
      });
      row.appendChild(button);
      promotionsList.appendChild(row);
    }
  } catch (err) {
    promotionsSection.hidden = true;
  }
}

async function loadRecommendations() {
  try {
    const data = await apiGet("/api/menu/recommendations");
    const picks = data.recommendations || [];
    if (picks.length === 0) {
      recommendationsSection.hidden = true;
      return;
    }
    recommendationsSection.hidden = false;
    recommendationsList.innerHTML = "";
    for (const item of picks) {
      const chip = document.createElement("div");
      chip.className = "recommendation-chip";
      chip.innerHTML = `<span class="recommendation-icon">${iconSvg(item.image)}</span><span>${item.name}</span>`;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Add";
      button.addEventListener("click", async () => {
        try {
          await apiSend("POST", "/api/order/items", { itemId: item.id });
          renderCart();
          loadRecommendations();
          updateCartCount();
        } catch (err) {
          alert(err.message);
        }
      });
      chip.appendChild(button);
      recommendationsList.appendChild(chip);
    }
  } catch (err) {
    recommendationsSection.hidden = true;
  }
}

// --- Checkout view ------------------------------------------------------

const pickupToggle = document.getElementById("pickupToggle");
const deliveryToggle = document.getElementById("deliveryToggle");
const dineInToggle = document.getElementById("dineInToggle");
const pickupForm = document.getElementById("pickupForm");
const deliveryForm = document.getElementById("deliveryForm");
const dineInForm = document.getElementById("dineInForm");
const pickupName = document.getElementById("pickupName");
const pickupTimeInput = document.getElementById("pickupTime");
const deliveryName = document.getElementById("deliveryName");
const deliveryPhone = document.getElementById("deliveryPhone");
const deliveryAddress = document.getElementById("deliveryAddress");
const deliveryApartment = document.getElementById("deliveryApartment");
const deliveryInstructions = document.getElementById("deliveryInstructions");
const dineInName = document.getElementById("dineInName");
const dineInPhone = document.getElementById("dineInPhone");
const fulfillmentReply = document.getElementById("fulfillmentReply");
const addressConfirm = document.getElementById("addressConfirm");
const addressConfirmText = document.getElementById("addressConfirmText");
const confirmAddressButton = document.getElementById("confirmAddressButton");
const reviewButton = document.getElementById("reviewButton");
const reviewSummary = document.getElementById("reviewSummary");
const placeOrderButton = document.getElementById("placeOrderButton");
const checkoutBlockers = document.getElementById("checkoutBlockers");
const orderConfirmedEl = document.getElementById("orderConfirmed");
const orderConfirmedText = document.getElementById("orderConfirmedText");
const newOrderButton = document.getElementById("newOrderButton");

const fulfillmentToggles = [pickupToggle, deliveryToggle, dineInToggle];
const fulfillmentForms = { pickup: pickupForm, delivery: deliveryForm, dine_in: dineInForm };

function selectFulfillmentType(type) {
  fulfillmentToggles.forEach((btn) => btn.classList.toggle("active", btn.dataset.type === type));
  Object.entries(fulfillmentForms).forEach(([key, form]) => {
    form.hidden = key !== type;
  });
}

pickupToggle.addEventListener("click", () => selectFulfillmentType("pickup"));
deliveryToggle.addEventListener("click", () => selectFulfillmentType("delivery"));
dineInToggle.addEventListener("click", () => selectFulfillmentType("dine_in"));

pickupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await apiSend("POST", "/api/order/pickup", {
      name: pickupName.value.trim() || undefined,
      pickupTime: pickupTimeInput.value.trim() || undefined,
    });
    fulfillmentReply.hidden = false;
    fulfillmentReply.textContent = data.reply;
  } catch (err) {
    fulfillmentReply.hidden = false;
    fulfillmentReply.textContent = err.message;
  }
});

dineInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await apiSend("POST", "/api/order/dine-in", {
      name: dineInName.value.trim() || undefined,
      phone: dineInPhone.value.trim() || undefined,
    });
    fulfillmentReply.hidden = false;
    fulfillmentReply.textContent = data.reply;
  } catch (err) {
    fulfillmentReply.hidden = false;
    fulfillmentReply.textContent = err.message;
  }
});

deliveryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await apiSend("POST", "/api/order/delivery", {
      name: deliveryName.value.trim() || undefined,
      phone: deliveryPhone.value.trim() || undefined,
      address: deliveryAddress.value.trim() || undefined,
      apartmentUnit: deliveryApartment.value.trim() || undefined,
      instructions: deliveryInstructions.value.trim() || undefined,
    });

    if (data.reply && data.reply.startsWith("Please confirm your delivery address")) {
      addressConfirm.hidden = false;
      addressConfirmText.textContent = data.reply;
      fulfillmentReply.hidden = true;
    } else {
      addressConfirm.hidden = true;
      fulfillmentReply.hidden = false;
      fulfillmentReply.textContent = data.reply;
    }
  } catch (err) {
    fulfillmentReply.hidden = false;
    fulfillmentReply.textContent = err.message;
  }
});

confirmAddressButton.addEventListener("click", async () => {
  try {
    const data = await apiSend("POST", "/api/order/delivery/confirm-address");
    addressConfirm.hidden = true;
    fulfillmentReply.hidden = false;
    fulfillmentReply.textContent = data.reply;
  } catch (err) {
    alert(err.message);
  }
});

reviewButton.addEventListener("click", async () => {
  try {
    const data = await apiGet("/api/order/review");
    renderReview(data.review);
  } catch (err) {
    reviewSummary.textContent = err.message;
  }
});

function renderReview(review) {
  const itemRows = review.items
    .map((item) => {
      const addOnNames = (item.addOns || []).map((a) => a.name);
      const details = [item.size, ...item.options, ...addOnNames].filter(Boolean).join(" · ");
      return `
        <div class="review-item-row">
          <div class="review-item-main">
            ${item.quantity}x ${item.name}
            ${details ? `<span class="review-item-detail">${details}</span>` : ""}
            ${item.notes ? `<span class="review-item-detail">Note: ${item.notes}</span>` : ""}
          </div>
          <div class="review-item-price">${formatMoney(item.lineTotal)}</div>
        </div>
      `;
    })
    .join("");

  let fulfillmentLine = "Fulfillment not yet selected.";
  if (review.fulfillment.type === "pickup") {
    const timeNote = review.fulfillment.pickupTime ? `, ${review.fulfillment.pickupTime}` : "";
    fulfillmentLine = `Pickup for ${review.fulfillment.name || "(name needed)"}${timeNote}`;
  } else if (review.fulfillment.type === "delivery") {
    const f = review.fulfillment;
    const addressNote = f.apartmentUnit ? `${f.address}, ${f.apartmentUnit}` : f.address;
    fulfillmentLine = `Delivery for ${f.name || "(name needed)"} to ${addressNote || "(address needed)"}${
      f.addressConfirmed ? "" : " (address not yet confirmed)"
    }`;
  } else if (review.fulfillment.type === "dine_in") {
    fulfillmentLine = `Dine-in for ${review.fulfillment.name || "(name needed)"}, ${review.fulfillment.phone || "(phone needed)"}`;
  }

  const p = review.pricing;
  const priceBits = [`Subtotal: ${formatMoney(p.subtotal)}`];
  if (p.discount > 0) priceBits.push(`Discount: -${formatMoney(p.discount)}`);
  priceBits.push(`Tax: ${formatMoney(p.tax)}`);
  if (p.deliveryFee > 0) priceBits.push(`Delivery fee: ${formatMoney(p.deliveryFee)}`);
  priceBits.push(`Total: ${formatMoney(p.total)}`);

  reviewSummary.innerHTML = `
    <div class="review-items">${itemRows || '<p class="empty-state">No items yet.</p>'}</div>
    <p><strong>Fulfillment:</strong> ${fulfillmentLine}</p>
    ${review.notes ? `<p><strong>Order note:</strong> ${review.notes}</p>` : ""}
    ${review.promotions.applied ? `<p><strong>Promotion:</strong> ${review.promotions.applied.name}</p>` : ""}
    <p>${priceBits.join(", ")}</p>
  `;

  placeOrderButton.disabled = !review.readyForCheckout.ready;
  if (review.readyForCheckout.ready) {
    checkoutBlockers.hidden = true;
  } else {
    checkoutBlockers.hidden = false;
    checkoutBlockers.textContent = `Still needed: ${review.readyForCheckout.blockers.join(", ")}`;
  }
}

placeOrderButton.addEventListener("click", async () => {
  placeOrderButton.disabled = true;
  try {
    // A fixed, known-good phrase — the backend only accepts an explicit,
    // unambiguous confirmation, so this is a button, not free text.
    const data = await apiSend("POST", "/api/order/confirm", { customerReply: "confirm" });
    orderConfirmedEl.hidden = false;
    // A short success message only — the itemized order (already reviewed
    // just before placing it) doesn't need to repeat here.
    const shortOrderId = data.orderId ? data.orderId.slice(0, 8) : null;
    orderConfirmedText.textContent = shortOrderId
      ? `🎉 Order #${shortOrderId} placed successfully! Total ${formatMoney(data.orderTotal)}.`
      : "🎉 Your order was placed successfully!";
    reviewSummary.innerHTML = "";
    checkoutBlockers.hidden = true;
    updateCartCount();
  } catch (err) {
    checkoutBlockers.hidden = false;
    checkoutBlockers.textContent = err.message;
    placeOrderButton.disabled = false;
  }
});

function resetCheckoutForms() {
  orderConfirmedEl.hidden = true;
  pickupForm.reset();
  deliveryForm.reset();
  dineInForm.reset();
  fulfillmentReply.hidden = true;
  addressConfirm.hidden = true;
  reviewSummary.innerHTML = "";
  placeOrderButton.disabled = true;
  selectFulfillmentType("pickup");
}

newOrderButton.addEventListener("click", () => {
  // The backend already reset the order in-memory the moment it was
  // confirmed — the same sessionId keeps working, order history persists.
  state.order = null;
  resetCheckoutForms();
  updateCartCount();
  showTab("menu");
});

// --- Orders tab ---------------------------------------------------------

const ordersList = document.getElementById("ordersList");
const ORDER_STATUS_LABELS = {
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

async function loadOrderHistory() {
  ordersList.innerHTML = '<p class="empty-state">Loading your orders...</p>';
  try {
    const data = await apiGet("/api/order/history");
    renderOrderHistory(data.orders || []);
  } catch (err) {
    ordersList.innerHTML = '<p class="empty-state">Could not load your orders.</p>';
  }
}

function renderOrderHistory(orders) {
  if (orders.length === 0) {
    ordersList.innerHTML = '<p class="empty-state">No orders yet — placed orders will show up here.</p>';
    return;
  }

  ordersList.innerHTML = "";
  for (const record of orders) {
    const order = record.order;
    const card = document.createElement("div");
    card.className = "order-history-card";

    const lines = order.items.map((item) => `${item.quantity}x ${item.name}`).join(", ");
    const fulfillmentLabel =
      order.orderType === "dine_in" ? "Dine-in" : order.orderType === "delivery" ? "Delivery" : "Pickup";
    const status = ORDER_STATUS_LABELS[record.status] || record.status;

    card.innerHTML = `
      <div class="order-history-header">
        <span class="order-id">#${record.orderId.slice(0, 8)}</span>
        <span class="status-badge" data-status="${record.status}">${status}</span>
      </div>
      <div class="order-history-items">${lines}</div>
      <div class="order-history-meta">${fulfillmentLabel} · ${formatMoney(order.total)} · ${new Date(record.createdAt).toLocaleString()}</div>
    `;
    ordersList.appendChild(card);
  }
}

// On load, silently pick up any cart already in progress for this session
// (e.g. a page refresh) so the floating cart button reflects reality
// immediately instead of only after the customer switches tabs.
if (state.sessionId) {
  apiGet("/api/order/summary")
    .then(updateCartCount)
    .catch(() => {});
}


// Closing RoboCap always lands on Menu specifically (not "whichever tab
// was active before" — that's Cart/Checkout's back-button convention, and
// opening the floater doesn't touch state.previousMainTab at all).
document.getElementById("chatCloseButton").addEventListener("click", closeChatWindow);

// Menu is the landing page — showTab's own lazy-load only fires when it's
// the *target* of a tab switch, so it never ran on load when Menu just
// started as the active panel. Trigger it explicitly here instead.
showTab("menu");
