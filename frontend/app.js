// CafeBot chat interface + guided ordering UI.
//
// The "Chat" tab sends free text to POST /api/chat, which calls a real AI
// provider (see backend/server.js — AI_API_KEY etc.) with tool-calling
// wired to the same order actions the Menu/Cart/Checkout tabs use, so
// chat and the guided UI share one live order/session.

// Relative — the backend now serves this file itself (see backend/server.js,
// express.static), so API calls are always same-origin. If you ever run the
// frontend from a separate static server again, hardcode the backend's URL
// here instead (e.g. "http://localhost:3000").
const API_BASE = "";
const SESSION_STORAGE_KEY = "cafebotSessionId";

const chatArea = document.getElementById("chatArea");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");
const micButton = document.getElementById("micButton");

// Seed conversation shown when the page loads.
const initialMessages = [
  { sender: "bot", text: "Vanakkam! Welcome to South Indian Cafe 🙏 How can I help you today?" },
  { sender: "user", text: "Hi! Can I see the menu?" },
  { sender: "bot", text: "Of course! We've got Tiffins, Dosa Varieties, Rice & Meals, Snacks & Starters, South Indian Beverages, and Desserts & Sweets. What are you in the mood for?" },
];

// Conversation sent to the AI as context — {role: "user"|"assistant", content}.
// Starts empty; the seed bubbles above are decorative and not real history.
const chatHistory = [];

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function appendMessage(sender, text) {
  const row = document.createElement("div");
  row.className = `message-row ${sender}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

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
    // Tool calls from this turn may have changed the order — reflect it.
    updateCartCount();
  } catch (err) {
    removeTypingIndicator();
    appendMessage("bot", err.message || "Sorry, something went wrong. Please try again.");
  } finally {
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
  sendChatMessage(text);
});

// Ensure Enter reliably sends the message across browsers/input methods.
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

// --- Speech-to-text (mic button) ------------------------------------------
// Uses the browser's built-in Web Speech API — no server involved, no new
// dependency. Only shown if the browser actually supports it (Safari
// desktop and some others don't); fills the input for the customer to
// review rather than auto-sending, since misheard speech shouldn't place
// an order unreviewed.
const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognitionApi) {
  const recognition = new SpeechRecognitionApi();
  recognition.lang = "en-IN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  let listening = false;

  micButton.hidden = false;

  recognition.addEventListener("result", (event) => {
    const transcript = event.results[0][0].transcript;
    chatInput.value = transcript;
    chatInput.focus();
  });

  recognition.addEventListener("end", () => {
    listening = false;
    micButton.classList.remove("mic-listening");
  });

  recognition.addEventListener("error", () => {
    listening = false;
    micButton.classList.remove("mic-listening");
  });

  micButton.addEventListener("click", () => {
    if (listening) {
      recognition.stop();
      return;
    }
    listening = true;
    micButton.classList.add("mic-listening");
    recognition.start();
  });
}

// Render the seeded conversation on load.
initialMessages.forEach((msg) => appendMessage(msg.sender, msg.text));

// ---------------------------------------------------------------------
// Guided ordering UI — real backend calls, no AI involved. Everything
// below is additive and independent of the mock chat logic above.
// ---------------------------------------------------------------------

const state = {
  sessionId: sessionStorage.getItem(SESSION_STORAGE_KEY) || null,
  order: null,
  menu: [],
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

// --- Tabs ---------------------------------------------------------------

const tabBar = document.getElementById("tabBar");
const tabButtons = tabBar.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");

function showTab(name) {
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  tabPanels.forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));

  if (name === "menu" && state.menu.length === 0) loadMenu();
  if (name === "cart") refreshCartTab();
  if (name === "checkout") refreshCheckoutTab();
}

tabBar.addEventListener("click", (event) => {
  const button = event.target.closest(".tab-button");
  if (button) showTab(button.dataset.tab);
});

// --- Menu tab -------------------------------------------------------------

const menuList = document.getElementById("menuList");

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

function renderMenu() {
  menuList.innerHTML = "";

  const categories = [...new Set(state.menu.map((item) => item.category))];
  for (const category of categories) {
    const heading = document.createElement("div");
    heading.className = "menu-category";
    heading.textContent = category;
    menuList.appendChild(heading);

    for (const item of state.menu.filter((i) => i.category === category)) {
      menuList.appendChild(buildMenuItemCard(item));
    }
  }
}

function buildMenuItemCard(item) {
  const card = document.createElement("div");
  card.className = "menu-item-card";

  const priceRange =
    item.sizes.length === 1
      ? formatMoney(item.sizes[0].price)
      : `${formatMoney(Math.min(...item.sizes.map((s) => s.price)))}–${formatMoney(Math.max(...item.sizes.map((s) => s.price)))}`;

  card.innerHTML = `
    <div class="menu-item-header">
      <span class="menu-item-name">${item.name}</span>
      <span class="menu-item-price">${priceRange}</span>
    </div>
    <p class="menu-item-description">${item.description}</p>
    ${!item.available ? '<span class="menu-item-unavailable">Sold out</span>' : ""}
  `;

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

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = "Add to order";
  addButton.addEventListener("click", async () => {
    addButton.disabled = true;
    try {
      await apiSend("POST", "/api/order/items", {
        itemId: item.id,
        size: sizeSelect ? sizeSelect.value : undefined,
        options: optionCheckboxes.filter((c) => c.checked).map((c) => c.value),
      });
      updateCartCount();
      flashButton(addButton, "Added!");
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
  }, 1500);
}

// --- Cart tab -------------------------------------------------------------

const cartCount = document.getElementById("cartCount");
const cartItems = document.getElementById("cartItems");
const cartTotals = document.getElementById("cartTotals");
const promotionsSection = document.getElementById("promotionsSection");
const promotionsList = document.getElementById("promotionsList");
const recommendationsSection = document.getElementById("recommendationsSection");
const recommendationsList = document.getElementById("recommendationsList");

function updateCartCount() {
  const count = state.order ? state.order.items.reduce((sum, i) => sum + i.quantity, 0) : 0;
  cartCount.textContent = String(count);
  cartCount.hidden = count === 0;
}

async function refreshCartTab() {
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
    return;
  }

  cartItems.innerHTML = "";
  for (const item of order.items) {
    const row = document.createElement("div");
    row.className = "cart-item";
    const customizations = item.options.length > 0 ? `, ${item.options.join(", ")}` : "";
    row.innerHTML = `
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name} (${item.size}${customizations})</div>
        <div class="cart-item-price">${formatMoney(item.unitPrice)} each</div>
      </div>
      <div class="cart-item-controls">
        <button type="button" class="qty-btn" data-action="decrease">−</button>
        <span class="qty-value">${item.quantity}</span>
        <button type="button" class="qty-btn" data-action="increase">+</button>
        <button type="button" class="remove-btn" data-action="remove">Remove</button>
      </div>
    `;

    row.querySelector('[data-action="increase"]').addEventListener("click", () =>
      changeItemQuantity(item.lineId, item.quantity + 1)
    );
    row.querySelector('[data-action="decrease"]').addEventListener("click", () =>
      changeItemQuantity(item.lineId, item.quantity - 1)
    );
    row.querySelector('[data-action="remove"]').addEventListener("click", () => removeItem(item.lineId));

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
      chip.innerHTML = `<span>${item.name}</span>`;
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

// --- Checkout tab -----------------------------------------------------

const pickupToggle = document.getElementById("pickupToggle");
const deliveryToggle = document.getElementById("deliveryToggle");
const pickupForm = document.getElementById("pickupForm");
const deliveryForm = document.getElementById("deliveryForm");
const pickupName = document.getElementById("pickupName");
const pickupTime = document.getElementById("pickupTime");
const deliveryName = document.getElementById("deliveryName");
const deliveryPhone = document.getElementById("deliveryPhone");
const deliveryAddress = document.getElementById("deliveryAddress");
const deliveryApartment = document.getElementById("deliveryApartment");
const deliveryInstructions = document.getElementById("deliveryInstructions");
const fulfillmentReply = document.getElementById("fulfillmentReply");
const addressConfirm = document.getElementById("addressConfirm");
const addressConfirmText = document.getElementById("addressConfirmText");
const confirmAddressButton = document.getElementById("confirmAddressButton");
const reviewButton = document.getElementById("reviewButton");
const reviewSummary = document.getElementById("reviewSummary");
const placeOrderButton = document.getElementById("placeOrderButton");
const checkoutBlockers = document.getElementById("checkoutBlockers");
const orderConfirmed = document.getElementById("orderConfirmed");
const orderConfirmedText = document.getElementById("orderConfirmedText");
const newOrderButton = document.getElementById("newOrderButton");

function refreshCheckoutTab() {
  addressConfirm.hidden = true;
  fulfillmentReply.hidden = true;
  if (state.order && state.order.orderType === "delivery") {
    deliveryToggle.click();
  }
}

pickupToggle.addEventListener("click", () => {
  pickupToggle.classList.add("active");
  deliveryToggle.classList.remove("active");
  pickupForm.hidden = false;
  deliveryForm.hidden = true;
});

deliveryToggle.addEventListener("click", () => {
  deliveryToggle.classList.add("active");
  pickupToggle.classList.remove("active");
  deliveryForm.hidden = false;
  pickupForm.hidden = true;
});

pickupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await apiSend("POST", "/api/order/pickup", {
      name: pickupName.value.trim() || undefined,
      pickupTime: pickupTime.value.trim() || undefined,
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
  const lines = review.items.map((item) => {
    const customizations = item.options.length > 0 ? `, ${item.options.join(", ")}` : "";
    return `${item.quantity}x ${item.name} (${item.size}${customizations})`;
  });

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
  }

  const p = review.pricing;
  const priceBits = [`Subtotal: ${formatMoney(p.subtotal)}`];
  if (p.discount > 0) priceBits.push(`Discount: -${formatMoney(p.discount)}`);
  priceBits.push(`Tax: ${formatMoney(p.tax)}`);
  if (p.deliveryFee > 0) priceBits.push(`Delivery fee: ${formatMoney(p.deliveryFee)}`);
  priceBits.push(`Total: ${formatMoney(p.total)}`);

  reviewSummary.innerHTML = `
    <p><strong>Items:</strong> ${lines.join("; ") || "none"}</p>
    <p><strong>Fulfillment:</strong> ${fulfillmentLine}</p>
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
    orderConfirmed.hidden = false;
    orderConfirmedText.textContent = data.reply;
    reviewSummary.innerHTML = "";
    checkoutBlockers.hidden = true;
    updateCartCount();
  } catch (err) {
    checkoutBlockers.hidden = false;
    checkoutBlockers.textContent = err.message;
    placeOrderButton.disabled = false;
  }
});

newOrderButton.addEventListener("click", () => {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  state.sessionId = null;
  state.order = null;
  orderConfirmed.hidden = true;
  pickupForm.reset();
  deliveryForm.reset();
  fulfillmentReply.hidden = true;
  addressConfirm.hidden = true;
  reviewSummary.innerHTML = "";
  placeOrderButton.disabled = true;
  updateCartCount();
  showTab("menu");
});
