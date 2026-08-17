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
// Order matters here: chip width varies a lot by label length, and
// flex-wrap packs greedily in array order (fills the current row, wraps
// when the next chip doesn't fit — it never backfills an earlier row).
// This order was chosen by measuring real rendered chip widths and running
// a bin-packing pass to minimize row count (8 rows -> 7 at a 375px mobile
// viewport) rather than just listing chips in topic order.
const WELCOME_QUICK_REPLIES = [
  "👥 Suggest something for two",
  "🌶️ spicy dishes",
  "🍽️ Suggest a complete meal",
  "👨‍🍳 chef's recommendations",
  "Show me non-veg options",
  "💰 items under ₹200",
  "👨‍🍳 recommend something",
  "💰 items under ₹500",
  "🔥 What's special today?",
  "⭐ Show bestsellers",
  "🥗 Show me veg options",
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

function iconSvg(imageKey) {
  const key = (imageKey || "").replace(/^icon:/, "");
  const spec = MENU_ICONS[key] || { emoji: "🍽️", bg: "#ece7dd" };
  return (
    `<svg viewBox="0 0 40 40" width="40" height="40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<circle cx="20" cy="20" r="20" fill="${spec.bg}" />` +
    `<text x="20" y="26" font-size="18" text-anchor="middle">${spec.emoji}</text>` +
    `</svg>`
  );
}

// RoboCap's avatar — one small inline SVG, reused on every bot message bubble.
const ROBOCAP_AVATAR_SVG =
  '<svg viewBox="0 0 40 40" width="28" height="28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<circle cx="20" cy="20" r="20" fill="#2f5fa8" />' +
  '<line x1="20" y1="14" x2="20" y2="9" stroke="#fff" stroke-width="2" stroke-linecap="round" />' +
  '<circle cx="20" cy="8" r="2" fill="#fff" />' +
  '<rect x="10" y="14" width="20" height="16" rx="6" fill="#fff" />' +
  '<circle cx="16" cy="22" r="2.2" fill="#2f5fa8" />' +
  '<circle cx="24" cy="22" r="2.2" fill="#2f5fa8" />' +
  '<rect x="15" y="27" width="10" height="2" rx="1" fill="#2f5fa8" />' +
  "</svg>";

const chatArea = document.getElementById("chatArea");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");
const micButton = document.getElementById("micButton");
const quickRepliesEl = document.getElementById("quickReplies");
const orderLockedBanner = document.getElementById("orderLockedBanner");
const startOverButton = document.getElementById("startOverButton");
const muteToggleButton = document.getElementById("muteToggleButton");

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

function updateMuteButtonUi() {
  muteToggleButton.classList.toggle("muted", ttsMuted);
  muteToggleButton.setAttribute("aria-pressed", String(ttsMuted));
  muteToggleButton.setAttribute("aria-label", ttsMuted ? "Unmute RoboCap voice" : "Mute RoboCap voice");
}
updateMuteButtonUi();

function stopSpeaking() {
  ttsAudio.pause();
  ttsAudio.currentTime = 0;
}

muteToggleButton.addEventListener("click", () => {
  ttsMuted = !ttsMuted;
  localStorage.setItem(MUTE_STORAGE_KEY, String(ttsMuted));
  updateMuteButtonUi();
  if (ttsMuted) stopSpeaking();
});

async function speak(text) {
  if (ttsMuted || !text) return;
  stopSpeaking(); // a fast-arriving reply should never talk over the previous one
  ttsAudio.src = `${API_BASE}/api/tts?text=${encodeURIComponent(text)}`;
  try {
    await ttsAudio.play();
  } catch (err) {
    // Autoplay can be blocked before any user gesture, and the request can
    // fail (not configured, rate-limited) — voice is optional, fail silent.
  }
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// RoboCap's replies use markdown-style **bold** for item names and other
// important terms — escape first (this is model-generated text going into
// the DOM), then turn the already-escaped ** markers into <strong> tags.
function formatBotText(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function appendMessage(sender, text) {
  const row = document.createElement("div");
  row.className = `message-row ${sender}`;

  if (sender === "bot") {
    const avatar = document.createElement("div");
    avatar.className = "bot-avatar";
    avatar.innerHTML = ROBOCAP_AVATAR_SVG;
    row.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (sender === "bot") {
    bubble.innerHTML = formatBotText(text);
    speak(text);
  } else {
    bubble.textContent = text;
  }

  const time = document.createElement("span");
  time.className = "message-time";
  time.textContent = formatTime(new Date());
  bubble.appendChild(time);

  row.appendChild(bubble);
  chatArea.appendChild(row);
  chatArea.scrollTop = chatArea.scrollHeight;
  return row;
}

function showTypingIndicator() {
  const row = document.createElement("div");
  row.className = "message-row bot";
  row.id = "typingIndicator";

  const avatar = document.createElement("div");
  avatar.className = "bot-avatar";
  avatar.innerHTML = ROBOCAP_AVATAR_SVG;
  row.appendChild(avatar);

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

// Plain string quick-replies only (fulfillment/confirm/spice-level/
// quantity/welcome starters). Item cards render directly in the chat
// transcript instead — see appendItemList — so they scroll naturally with
// the conversation rather than competing for space in this strip.
function renderQuickReplies(quickReplies) {
  quickRepliesEl.innerHTML = "";

  if (!quickReplies || quickReplies.length === 0) {
    quickRepliesEl.hidden = true;
    updateCartCount();
    return;
  }

  quickRepliesEl.hidden = false;
  for (const qr of quickReplies) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "quick-reply-chip";
    chip.textContent = qr;
    chip.addEventListener("click", () => sendQuickReply(qr));
    quickRepliesEl.appendChild(chip);
  }
  updateCartCount();
}

function sendQuickReply(value) {
  appendMessage("user", value);
  renderQuickReplies(null);
  sendChatMessage(value);
}

function truncateWords(text, maxWords) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text || "";
  return `${words.slice(0, maxWords).join(" ")}…`;
}

// Renders items returned by an item-listing/comparison tool as cards
// appended directly to the chat transcript — not the quick-reply strip —
// so previous turns' items stay visible in the scrollback instead of being
// replaced by the next turn's, and they never crowd the input area.
function appendItemList(items) {
  const list = document.createElement("div");
  list.className = "chat-item-list";
  for (const item of items) {
    list.appendChild(buildChatItemRow(item));
  }
  chatArea.appendChild(list);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function buildChatItemRow(item) {
  const row = document.createElement("div");
  row.className = "chat-item-row";

  // Every menu item is either non-veg or veg — non-veg is always tagged
  // explicitly, but veg items are sometimes only tagged "vegan"/
  // "gluten-free" without the literal "vegetarian" string, so treat
  // "not tagged non-vegetarian" as the veg signal rather than requiring
  // an exact "vegetarian" match.
  const badges = [];
  if (item.dietary && item.dietary.includes("non-vegetarian")) {
    badges.push('<span class="badge badge-nonveg">Non-veg</span>');
  } else {
    badges.push('<span class="badge badge-veg">Veg</span>');
  }
  if (item.bestseller) badges.push('<span class="badge badge-bestseller">Bestseller</span>');
  if (item.spicy) badges.push('<span class="badge badge-spicy">🌶️ Spicy</span>');
  if (item.recommended) badges.push('<span class="badge badge-recommended">Recommended</span>');

  row.innerHTML = `
    <span class="chat-item-row-image">${iconSvg(item.image)}</span>
    <div class="chat-item-row-info">
      <div class="chat-item-row-top">
        <span class="chat-item-row-name">${item.label}</span>
        ${item.price != null ? `<span class="chat-item-row-price">₹${Number(item.price).toFixed(0)}</span>` : ""}
      </div>
      ${badges.length > 0 ? `<div class="chat-item-row-badges">${badges.join("")}</div>` : ""}
      ${item.description ? `<p class="chat-item-row-desc">${truncateWords(item.description, 10)}</p>` : ""}
    </div>
    <div class="chat-item-row-action"></div>
  `;

  row.querySelector(".chat-item-row-action").appendChild(buildAddControl(item));
  return row;
}

// A per-row Add control: tapping Add reveals a small quantity stepper
// in place of the button — confirming it adds directly via REST with that
// quantity (no AI round-trip for a simple, unambiguous item). An item that
// needs a size/add-on choice falls back to the chat pipeline so the AI can
// ask conversationally, same as a typed request.
function buildAddControl(item) {
  const wrap = document.createElement("div");
  wrap.className = "chat-item-add";

  function renderIdle() {
    wrap.innerHTML = "";
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "chat-item-add-button";
    addButton.textContent = "Add";
    addButton.addEventListener("click", renderStepper);
    wrap.appendChild(addButton);
  }

  function renderStepper() {
    let qty = 1;
    wrap.innerHTML = "";
    wrap.classList.add("chat-item-add--stepper");

    const stepper = document.createElement("div");
    stepper.className = "chat-item-qty-stepper";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.setAttribute("aria-label", "Decrease quantity");
    minus.textContent = "−";
    const qtyLabel = document.createElement("span");
    qtyLabel.textContent = String(qty);
    const plus = document.createElement("button");
    plus.type = "button";
    plus.setAttribute("aria-label", "Increase quantity");
    plus.textContent = "+";

    minus.addEventListener("click", () => {
      if (qty > 1) qtyLabel.textContent = String((qty -= 1));
    });
    plus.addEventListener("click", () => {
      if (qty < 10) qtyLabel.textContent = String((qty += 1));
    });

    stepper.append(minus, qtyLabel, plus);

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "chat-item-qty-confirm";
    confirm.innerHTML = "✓ Add";
    confirm.addEventListener("click", () => confirmChatItemAdd(item, qty, wrap, renderIdle));

    wrap.append(stepper, confirm);
  }

  renderIdle();
  return wrap;
}

async function confirmChatItemAdd(item, quantity, wrap, resetToIdle) {
  wrap.innerHTML = '<span class="chat-item-add-status">Adding…</span>';
  try {
    const data = await apiSend("POST", "/api/order/items", { itemId: item.itemId, quantity });
    if (data.needsClarification) {
      resetToIdle();
      appendMessage("user", item.value);
      sendChatMessage(item.value);
      return;
    }
    wrap.innerHTML = '<span class="chat-item-add-status chat-item-add-status--success">Added ✓</span>';
    updateCartCount();
    const summary = `Added **${item.label}** to your cart. Would you like anything else, or are you ready to proceed with fulfillment?`;
    appendMessage("bot", summary);
    chatHistory.push({ role: "assistant", content: summary });
    setTimeout(resetToIdle, 1800);
  } catch (err) {
    wrap.innerHTML = `<span class="chat-item-add-status chat-item-add-status--error">${escapeHtml(err.message)}</span>`;
    setTimeout(resetToIdle, 1800);
  }
}

// Conversation sent to the AI as context — {role: "user"|"assistant", content}.
// Starts empty; the seed bubbles are decorative and not real history.
const chatHistory = [];

function lockChatInput(locked) {
  chatInput.disabled = locked;
  sendButton.disabled = locked;
  micButton.disabled = locked;
  chatInput.hidden = locked;
  sendButton.hidden = locked;
  micButton.hidden = locked || !SpeechRecognitionApi;
  orderLockedBanner.hidden = !locked;
}

async function sendChatMessage(text) {
  chatInput.disabled = true;
  sendButton.disabled = true;
  showTypingIndicator();

  try {
    const data = await apiSend("POST", "/api/chat", { message: text, history: chatHistory });
    chatHistory.push({ role: "user", content: text });
    chatHistory.push({ role: "assistant", content: data.reply });
    removeTypingIndicator();
    appendMessage("bot", data.reply);

    const isItemList = Array.isArray(data.quickReplies) && data.quickReplies.length > 0 && typeof data.quickReplies[0] === "object";
    if (isItemList) {
      renderQuickReplies(null);
      appendItemList(data.quickReplies);
    } else {
      renderQuickReplies(data.quickReplies);
    }
    // Tool calls this turn may have changed the order — reflect it everywhere.
    updateCartCount();

    if (data.orderJustConfirmed) {
      lockChatInput(true);
    }
  } catch (err) {
    removeTypingIndicator();
    appendMessage("bot", err.message || "Sorry, something went wrong. Please try again.");
  } finally {
    if (!orderLockedBanner.hidden) return;
    chatInput.disabled = false;
    sendButton.disabled = false;
    chatInput.focus();
  }
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  appendMessage("user", text);
  chatInput.value = "";
  renderQuickReplies(null);
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
  chatInput.focus();
  // A fresh order shouldn't drag the previous order's entire conversation
  // into the AI's context on every future turn.
  chatHistory.length = 0;
  appendMessage("bot", "Ready when you are — what would you like today?");
  renderQuickReplies(WELCOME_QUICK_REPLIES);
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
  // Without this, the browser applies its own (often sub-2s) silence
  // detection and ends the session before our timer below ever fires —
  // that was the actual cause of "auto-send isn't working". With
  // continuous on, only our own timer decides when to stop.
  recognition.continuous = true;
  let listening = false;
  let autoSendPending = false;
  let silenceTimer = null;
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
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    chatInput.value = transcript;

    clearTimeout(silenceTimer);
    startSendCountdown();
    silenceTimer = setTimeout(() => {
      autoSendPending = true;
      recognition.stop();
    }, SILENCE_AUTO_SEND_MS);
  });

  recognition.addEventListener("end", () => {
    listening = false;
    micButton.classList.remove("mic-listening");
    clearTimeout(silenceTimer);
    cancelSendCountdown();

    if (autoSendPending) {
      autoSendPending = false;
      if (chatInput.value.trim()) chatForm.requestSubmit();
    } else {
      chatInput.focus();
    }
  });

  recognition.addEventListener("error", () => {
    listening = false;
    autoSendPending = false;
    clearTimeout(silenceTimer);
    cancelSendCountdown();
    micButton.classList.remove("mic-listening");
  });

  micButton.addEventListener("click", () => {
    if (listening) {
      autoSendPending = false;
      clearTimeout(silenceTimer);
      cancelSendCountdown();
      recognition.stop();
      return;
    }
    listening = true;
    micButton.classList.add("mic-listening");
    recognition.start();
  });
}

// ---------------------------------------------------------------------
// Guided ordering UI — real backend calls, shares state with SmartOrder.
// ---------------------------------------------------------------------

const state = {
  sessionId: sessionStorage.getItem(SESSION_STORAGE_KEY) || null,
  order: null,
  menu: [],
  previousMainTab: "chat",
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
const mainTabNames = ["chat", "menu", "orders"];

function showTab(name) {
  state.previousMainTab = name;
  allPanels.forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  tabBar.hidden = false;

  if (name === "menu" && state.menu.length === 0) loadMenu();
  if (name === "orders") loadOrderHistory();
  updateCartCount();
}

function showView(name) {
  allPanels.forEach((panel) => panel.classList.toggle("active", panel.id === `view-${name}`));
  tabBar.hidden = true;
  updateCartCount();
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

function updateCartCount() {
  const count = state.order ? state.order.items.reduce((sum, i) => sum + i.quantity, 0) : 0;
  floatingCartCount.textContent = String(count);
  const onMainTab = mainTabNames.some((t) => document.getElementById(`tab-${t}`).classList.contains("active"));
  // On the chat tab, quick-reply chips sit right above the input bar in the
  // same spot the floating pill occupies — showing both overlaps and blocks
  // taps, so give quick-replies priority while they're visible.
  const chatQuickRepliesShowing =
    document.getElementById("tab-chat").classList.contains("active") && !quickRepliesEl.hidden;
  floatingCartButton.hidden = count === 0 || !onMainTab || chatQuickRepliesShowing;

  // The floating pill is position:absolute and sits on top of the chat
  // transcript — pad the scroll area so the last message can still scroll
  // fully into view above it instead of being covered.
  chatArea.classList.toggle("chat-area--fab-padding", !floatingCartButton.hidden);
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

// Render the seeded conversation + static welcome quick-replies on load.
// Must come after everything above (state, DOM refs, updateCartCount) is
// defined, since renderQuickReplies now calls updateCartCount internally.
appendMessage("bot", "Vanakkam! My name is **RoboCap**! Your virtual Captain. How can I help you today?");
renderQuickReplies(WELCOME_QUICK_REPLIES);
