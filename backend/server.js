const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
// .env lives at the project root (alongside .env.example), not in backend/,
// so this must be resolved relative to this file rather than the cwd.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const SYSTEM_PROMPT_PATH = path.join(__dirname, "..", "prompts", "system-prompt.md");
const SYSTEM_PROMPT = fs.readFileSync(SYSTEM_PROMPT_PATH, "utf8");

const MENU_PATH = path.join(__dirname, "..", "data", "menu.json");
const MENU = JSON.parse(fs.readFileSync(MENU_PATH, "utf8"));

const PROMOTIONS_PATH = path.join(__dirname, "..", "data", "promotions.json");
const PROMOTIONS = JSON.parse(fs.readFileSync(PROMOTIONS_PATH, "utf8"));

// Append-only order log — read fresh and rewritten on each save, not cached.
const ORDERS_PATH = path.join(__dirname, "..", "data", "orders.json");

// Simple, hardcoded pricing config — edit these two values directly.
const TAX_RATE = 0.08; // 8% sales tax, applied to the discounted subtotal
const DELIVERY_FEE = 3.99; // flat fee, applied only to orderType "delivery"

// Staff dashboard credentials — required to access /api/staff/*. Set these
// in .env; there is no default, so auth fails closed if unconfigured.
const STAFF_USERNAME = process.env.STAFF_USERNAME || "";
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || "";
if (!STAFF_USERNAME || !STAFF_PASSWORD) {
  console.warn(
    "Warning: STAFF_USERNAME / STAFF_PASSWORD are not set in .env — " +
    "all /api/staff/* requests will be rejected until they are."
  );
}

app.use(express.json());

// Minimal CORS for local dev — the frontend is served from a different port.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Handle malformed JSON bodies with a clean error instead of Express's default HTML page.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON in request body." });
  }
  next(err);
});

function buildMessages(history, message) {
  const activePromotions = PROMOTIONS.promotions.filter((p) => p.active);

  const systemContent =
    `${SYSTEM_PROMPT}\n\n` +
    "## Menu Data\n" +
    "This is the only source of truth for menu items, prices, and availability. " +
    "Never invent items or prices that aren't listed here.\n\n" +
    JSON.stringify(MENU, null, 2) +
    "\n\n## Active Promotions\n" +
    "Only mention or apply a promotion listed here, and only when its eligibility " +
    "rules are satisfied by the current order. Never invent a discount or offer " +
    "one that isn't listed as active.\n\n" +
    JSON.stringify(activePromotions, null, 2) +
    "\n\n## Order Totals\n" +
    "Subtotal, discount, tax, delivery fee, and total are always calculated by " +
    "the system, never by you. Always state these numbers exactly as given in " +
    "the order data — never calculate, estimate, or adjust them yourself.";

  return [
    { role: "system", content: systemContent },
    ...history,
    { role: "user", content: message },
  ];
}

// Placeholder reply generator — swap this out for a real AI provider call later.
function getMockReply(messages) {
  return "Thanks for your message! (Placeholder reply — AI integration isn't connected yet.)";
}

// In-memory order state, keyed by sessionId. No database — state is lost on server restart.
const orderSessions = new Map();

function createEmptyOrder() {
  return {
    items: [], // [{ itemId, name, quantity, options, unitPrice }]
    orderType: null, // e.g. "pickup" | "delivery"
    customer: { name: null, phone: null },
    pickupTime: null, // optional, freeform (e.g. "ASAP", "3:30 PM")
    deliveryAddress: { address: null, apartmentUnit: null, instructions: null, confirmed: false },
    promotionId: null,
    subtotal: 0, // sum of item unitPrice * quantity, before discount/tax/fee
    discount: 0,
    tax: 0,
    deliveryFee: 0,
    total: 0, // subtotal - discount + tax + deliveryFee
    confirmed: false,
    status: "building", // "building" | "confirmed" | "cancelled"
    orderId: null, // set only once saved to data/orders.json after confirmation
  };
}

function getOrCreateOrder(sessionId) {
  if (!orderSessions.has(sessionId)) {
    orderSessions.set(sessionId, createEmptyOrder());
  }
  return orderSessions.get(sessionId);
}

function getOrderSubtotal(order) {
  return order.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

function round2(amount) {
  return Math.round(amount * 100) / 100;
}

// Checks a promotion's eligibility rules against the current order and time.
// Returns { eligible: true } or { eligible: false, reason } — never assumes
// eligibility for rules this backend can't actually verify (e.g. customerType).
function checkPromotionEligibility(order, promotion) {
  const e = promotion.eligibility || {};

  if (e.timeWindow) {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = e.timeWindow.start.split(":").map(Number);
    const [endH, endM] = e.timeWindow.end.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    if (nowMinutes < startMinutes || nowMinutes >= endMinutes) {
      return { eligible: false, reason: `only valid between ${e.timeWindow.start} and ${e.timeWindow.end}` };
    }
  }

  if (e.minOrderValue != null && getOrderSubtotal(order) < e.minOrderValue) {
    return { eligible: false, reason: `requires a minimum order of $${e.minOrderValue.toFixed(2)}` };
  }

  if (e.customerType && e.customerType !== "all") {
    return { eligible: false, reason: `requires customer type '${e.customerType}', which isn't verified here` };
  }

  if (Array.isArray(e.requiresItems)) {
    for (const requirement of e.requiresItems) {
      const [kind, value] = requirement.split(":");
      const satisfied = order.items.some((item) => {
        if (kind === "category") {
          const menuItem = MENU.items.find((m) => m.id === item.itemId);
          return menuItem && menuItem.category === value;
        }
        if (kind === "id") {
          return item.itemId === value;
        }
        return false;
      });
      if (!satisfied) {
        return { eligible: false, reason: `requires an item from ${requirement}` };
      }
    }
  }

  return { eligible: true };
}

// Returns only active promotions whose eligibility rules the order currently satisfies.
function getEligiblePromotions(order) {
  return PROMOTIONS.promotions.filter(
    (p) => p.active && checkPromotionEligibility(order, p).eligible
  );
}

function computeDiscountAmount(order, promotion) {
  const { discount } = promotion;
  let base;

  if (discount.appliesTo === "order_total") {
    base = getOrderSubtotal(order);
  } else if (discount.appliesTo.startsWith("category:")) {
    const category = discount.appliesTo.slice("category:".length);
    base = order.items
      .filter((item) => {
        const menuItem = MENU.items.find((m) => m.id === item.itemId);
        return menuItem && menuItem.category === category;
      })
      .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  } else {
    base = 0;
  }

  if (discount.type === "percentage") return base * (discount.value / 100);
  if (discount.type === "fixed_amount") return Math.min(discount.value, base);
  return 0;
}

// Deterministically recomputes the order's full price breakdown from menu
// prices, quantities, the applied promotion, and the fixed tax/fee config
// above. This is the only place order.total is ever set — never the model.
function recalculateTotal(order) {
  // Any change after confirmation invalidates it — the customer confirmed a
  // specific order, not whatever it becomes after further edits.
  if (order.confirmed) {
    order.confirmed = false;
    order.status = "building";
    order.orderId = null;
  }

  const subtotal = getOrderSubtotal(order);

  let discountAmount = 0;
  if (order.promotionId) {
    const promotion = PROMOTIONS.promotions.find((p) => p.id === order.promotionId);
    const check = promotion && promotion.active && checkPromotionEligibility(order, promotion);
    if (promotion && check.eligible) {
      discountAmount = computeDiscountAmount(order, promotion);
    } else {
      // The applied promotion is no longer active/eligible — never keep a stale discount.
      order.promotionId = null;
    }
  }

  const discountedSubtotal = subtotal - discountAmount;
  const tax = discountedSubtotal * TAX_RATE;
  const deliveryFee = order.orderType === "delivery" ? DELIVERY_FEE : 0;

  order.subtotal = round2(subtotal);
  order.discount = round2(discountAmount);
  order.tax = round2(tax);
  order.deliveryFee = round2(deliveryFee);
  order.total = round2(discountedSubtotal + tax + deliveryFee);
}

// Builds a concise, human-readable summary of the order's current items.
function summarizeOrder(order) {
  if (order.items.length === 0) {
    return "Your order is currently empty.";
  }

  const lines = order.items.map((item) => {
    const customizations = item.options.length > 0 ? `, ${item.options.join(", ")}` : "";
    return `${item.quantity}x ${item.name} (${item.size}${customizations})`;
  });

  const priceParts = [`Subtotal: $${order.subtotal.toFixed(2)}`];
  if (order.discount > 0) priceParts.push(`Discount: -$${order.discount.toFixed(2)}`);
  priceParts.push(`Tax: $${order.tax.toFixed(2)}`);
  if (order.deliveryFee > 0) priceParts.push(`Delivery fee: $${order.deliveryFee.toFixed(2)}`);
  priceParts.push(`Total: $${order.total.toFixed(2)}`);

  return `Your order: ${lines.join("; ")}. ${priceParts.join(", ")}.`;
}

// Picks up to 2 available menu items not already in the order, preferring
// categories the order doesn't have yet (e.g. a pastry alongside a coffee).
// Only ever pulls from MENU — never invents a product.
function getRecommendations(order) {
  const orderedItemIds = new Set(order.items.map((i) => i.itemId));
  const orderedCategories = new Set(
    order.items
      .map((i) => MENU.items.find((m) => m.id === i.itemId))
      .filter(Boolean)
      .map((m) => m.category)
  );

  const available = MENU.items.filter((item) => item.available && !orderedItemIds.has(item.id));
  const complementary = available.filter((item) => !orderedCategories.has(item.category));

  return (complementary.length > 0 ? complementary : available).slice(0, 2);
}

// Builds a soft, non-pushy recommendation message (or none, if nothing to suggest).
function summarizeRecommendations(order) {
  const picks = getRecommendations(order);
  if (picks.length === 0) {
    return { picks, reply: "No recommendations available right now." };
  }

  const names = picks.map((item) => item.name).join(" and ");
  return { picks, reply: `You might also like: ${names}.` };
}

// Builds a soft recommendation of currently active, eligible promotions.
function summarizeEligiblePromotions(order) {
  const eligible = getEligiblePromotions(order);
  if (eligible.length === 0) {
    return { eligible, reply: "No promotions are available for your order right now." };
  }

  const lines = eligible.map((p) => `${p.name} (${p.rule})`);
  return { eligible, reply: `You may be eligible for: ${lines.join("; ")}.` };
}

// Builds the complete, structured pre-checkout order summary: items and
// customizations, fulfillment details, valid promotions, and the deterministic
// pricing breakdown — plus whether the order actually has everything it needs.
function buildOrderReview(order) {
  const items = order.items.map((item) => ({
    name: item.name,
    size: item.size,
    quantity: item.quantity,
    options: item.options,
    unitPrice: item.unitPrice,
    lineTotal: round2(item.unitPrice * item.quantity),
  }));

  let fulfillment;
  if (order.orderType === "delivery") {
    fulfillment = {
      type: "delivery",
      name: order.customer.name,
      phone: order.customer.phone,
      address: order.deliveryAddress.address,
      apartmentUnit: order.deliveryAddress.apartmentUnit,
      instructions: order.deliveryAddress.instructions,
      addressConfirmed: order.deliveryAddress.confirmed,
    };
  } else if (order.orderType === "pickup") {
    fulfillment = { type: "pickup", name: order.customer.name, pickupTime: order.pickupTime };
  } else {
    fulfillment = { type: null };
  }

  const appliedPromotion = order.promotionId
    ? PROMOTIONS.promotions.find((p) => p.id === order.promotionId) || null
    : null;

  const pricing = {
    subtotal: order.subtotal,
    discount: order.discount,
    tax: order.tax,
    deliveryFee: order.deliveryFee,
    total: order.total,
  };

  const blockers = [];
  if (order.items.length === 0) blockers.push("no items in the order");
  if (!order.orderType) blockers.push("fulfillment method (pickup or delivery) not selected");
  if (order.orderType === "pickup" && !order.customer.name) {
    blockers.push("missing customer name");
  }
  if (order.orderType === "delivery") {
    if (!order.customer.name) blockers.push("missing customer name");
    if (!order.customer.phone) blockers.push("missing phone number");
    if (!order.deliveryAddress.address) blockers.push("missing delivery address");
    else if (!order.deliveryAddress.confirmed) blockers.push("delivery address not yet confirmed");
  }

  return {
    items,
    fulfillment,
    promotions: { applied: appliedPromotion, eligible: getEligiblePromotions(order) },
    pricing,
    readyForCheckout: { ready: blockers.length === 0, blockers },
  };
}

// Renders buildOrderReview() as a concise, human-readable message.
function summarizeOrderReview(order) {
  const review = buildOrderReview(order);

  if (review.items.length === 0) {
    return { review, reply: "Your order is currently empty." };
  }

  const lines = review.items.map((item) => {
    const customizations = item.options.length > 0 ? `, ${item.options.join(", ")}` : "";
    return `${item.quantity}x ${item.name} (${item.size}${customizations})`;
  });
  const parts = [`Items: ${lines.join("; ")}`];

  if (review.fulfillment.type === "pickup") {
    const timeNote = review.fulfillment.pickupTime ? `, ${review.fulfillment.pickupTime}` : "";
    parts.push(`Pickup for ${review.fulfillment.name || "(name needed)"}${timeNote}`);
  } else if (review.fulfillment.type === "delivery") {
    const f = review.fulfillment;
    const addressNote = f.apartmentUnit ? `${f.address}, ${f.apartmentUnit}` : f.address;
    const confirmedNote = f.addressConfirmed ? "" : " (address not yet confirmed)";
    parts.push(`Delivery for ${f.name || "(name needed)"} to ${addressNote || "(address needed)"}${confirmedNote}`);
  } else {
    parts.push("Fulfillment method not yet selected");
  }

  if (review.promotions.applied) {
    parts.push(`Applied promotion: ${review.promotions.applied.name}`);
  }

  const p = review.pricing;
  const priceBits = [`Subtotal: $${p.subtotal.toFixed(2)}`];
  if (p.discount > 0) priceBits.push(`Discount: -$${p.discount.toFixed(2)}`);
  priceBits.push(`Tax: $${p.tax.toFixed(2)}`);
  if (p.deliveryFee > 0) priceBits.push(`Delivery fee: $${p.deliveryFee.toFixed(2)}`);
  priceBits.push(`Total: $${p.total.toFixed(2)}`);
  parts.push(priceBits.join(", "));

  if (!review.readyForCheckout.ready) {
    parts.push(`Still needed before checkout: ${review.readyForCheckout.blockers.join("; ")}`);
  }

  return { review, reply: `${parts.join(". ")}.` };
}

// Adds one valid menu item to the order. Returns either an added item, a
// clarifying question (missing/invalid size), or a hard validation error.
function addItemToOrder(order, { itemId, size, quantity, options }) {
  if (typeof itemId !== "string" || itemId.trim().length === 0) {
    return { error: "itemId is required and must be a non-empty string." };
  }

  const menuItem = MENU.items.find((item) => item.id === itemId);
  if (!menuItem) {
    return { error: `Item '${itemId}' was not found in the menu.` };
  }

  if (!menuItem.available) {
    return { error: `'${menuItem.name}' is currently unavailable.` };
  }

  const qty = quantity === undefined ? 1 : quantity;
  if (!Number.isInteger(qty) || qty < 1) {
    return { error: "quantity must be a positive integer." };
  }

  let chosenSize;
  if (typeof size === "string") {
    // An explicit size was given — validate it regardless of how many sizes
    // this item has. Never silently substitute a different size.
    chosenSize = menuItem.sizes.find((s) => s.name.toLowerCase() === size.toLowerCase());
    if (!chosenSize) {
      const sizeNames = menuItem.sizes.map((s) => s.name).join(", ");
      return { error: `'${size}' is not a valid size for ${menuItem.name}. Choose from: ${sizeNames}.` };
    }
  } else if (menuItem.sizes.length === 1) {
    chosenSize = menuItem.sizes[0];
  } else {
    const sizeNames = menuItem.sizes.map((s) => s.name).join(", ");
    return {
      needsClarification: true,
      reply: `What size would you like for ${menuItem.name}? Choose from: ${sizeNames}.`,
    };
  }

  const requestedOptions = Array.isArray(options) ? options : [];
  const normalizedOptions = [];
  for (const requested of requestedOptions) {
    const match =
      typeof requested === "string"
        ? menuItem.options.find((o) => o.toLowerCase() === requested.toLowerCase())
        : undefined;

    if (!match) {
      const validOptions = menuItem.options.join(", ") || "none";
      return {
        error: `'${requested}' is not a valid option for ${menuItem.name}. Available options: ${validOptions}.`,
      };
    }
    normalizedOptions.push(match);
  }

  order.items.push({
    lineId: crypto.randomUUID(),
    itemId: menuItem.id,
    name: menuItem.name,
    size: chosenSize.name,
    quantity: qty,
    options: normalizedOptions,
    unitPrice: chosenSize.price,
  });
  recalculateTotal(order);

  return {
    reply: `Added ${qty} x ${menuItem.name} (${chosenSize.name}) to your order.`,
  };
}

// Modifies quantity, size, and/or options on an existing order line item.
// Each provided field is validated against the item's own menu entry.
function updateOrderItemInOrder(order, lineId, { quantity, size, options }) {
  const item = order.items.find((i) => i.lineId === lineId);
  if (!item) {
    return { error: `Order item '${lineId}' was not found.` };
  }

  if (quantity === undefined && size === undefined && options === undefined) {
    return { error: "Provide at least one of quantity, size, or options to update." };
  }

  const menuItem = MENU.items.find((m) => m.id === item.itemId);

  if (quantity !== undefined) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { error: "quantity must be a positive integer." };
    }
  }

  let chosenSize;
  if (size !== undefined) {
    chosenSize =
      typeof size === "string"
        ? menuItem.sizes.find((s) => s.name.toLowerCase() === size.toLowerCase())
        : undefined;

    if (!chosenSize) {
      const sizeNames = menuItem.sizes.map((s) => s.name).join(", ");
      return { error: `'${size}' is not a valid size for ${menuItem.name}. Choose from: ${sizeNames}.` };
    }
  }

  let normalizedOptions;
  if (options !== undefined) {
    if (!Array.isArray(options)) {
      return { error: "options must be an array of strings." };
    }
    normalizedOptions = [];
    for (const requested of options) {
      const match =
        typeof requested === "string"
          ? menuItem.options.find((o) => o.toLowerCase() === requested.toLowerCase())
          : undefined;

      if (!match) {
        const validOptions = menuItem.options.join(", ") || "none";
        return {
          error: `'${requested}' is not a valid option for ${menuItem.name}. Available options: ${validOptions}.`,
        };
      }
      normalizedOptions.push(match);
    }
  }

  if (quantity !== undefined) item.quantity = quantity;
  if (chosenSize !== undefined) {
    item.size = chosenSize.name;
    item.unitPrice = chosenSize.price;
  }
  if (normalizedOptions !== undefined) item.options = normalizedOptions;

  recalculateTotal(order);

  return { reply: `Updated ${item.name} (${item.size}).` };
}

// Removes an order item entirely, or reduces its quantity by a given amount
// (removing the line automatically once its quantity reaches zero).
function removeOrderItemFromOrder(order, lineId, { quantity }) {
  const index = order.items.findIndex((i) => i.lineId === lineId);
  if (index === -1) {
    return { error: `Order item '${lineId}' was not found.` };
  }

  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) {
    return { error: "quantity must be a positive integer." };
  }

  const item = order.items[index];
  const decrementBy = quantity === undefined ? item.quantity : quantity;

  let reply;
  if (decrementBy >= item.quantity) {
    order.items.splice(index, 1);
    reply = `Removed ${item.name} (${item.size}) from your order.`;
  } else {
    item.quantity -= decrementBy;
    reply = `Reduced ${item.name} (${item.size}) to ${item.quantity}.`;
  }

  recalculateTotal(order);
  return { reply };
}

// Applies a promotion to the order, but only if it's active and its
// eligibility rules are currently satisfied. Never invents a discount.
function applyPromotionToOrder(order, promotionId) {
  if (typeof promotionId !== "string" || promotionId.trim().length === 0) {
    return { error: "promotionId is required and must be a non-empty string." };
  }

  const promotion = PROMOTIONS.promotions.find((p) => p.id === promotionId);
  if (!promotion) {
    return { error: `Promotion '${promotionId}' was not found.` };
  }
  if (!promotion.active) {
    return { error: `'${promotion.name}' is not currently active.` };
  }

  const check = checkPromotionEligibility(order, promotion);
  if (!check.eligible) {
    return { error: `'${promotion.name}' is not eligible for this order (${check.reason}).` };
  }

  order.promotionId = promotion.id;
  recalculateTotal(order);

  return { reply: `Applied '${promotion.name}' — ${promotion.rule}` };
}

// Selects pickup as the order type and stores the customer's name (required)
// and pickup time (optional). Only asks for whatever is still missing.
function setPickupDetails(order, { name, pickupTime }) {
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return { error: "name must be a non-empty string." };
    }
    order.customer.name = name.trim();
  }

  if (pickupTime !== undefined) {
    if (typeof pickupTime !== "string" || pickupTime.trim().length === 0) {
      return { error: "pickupTime must be a non-empty string." };
    }
    order.pickupTime = pickupTime.trim();
  }

  order.orderType = "pickup";
  recalculateTotal(order); // orderType affects deliveryFee

  if (!order.customer.name) {
    return { needsClarification: true, reply: "What name should we put the pickup order under?" };
  }

  const timeNote = order.pickupTime ? ` for ${order.pickupTime}` : "";
  return { reply: `Got it — pickup order for ${order.customer.name}${timeNote}.` };
}

// Selects delivery as the order type and stores the customer's name, phone,
// and full address (all required), plus apartment/unit and delivery
// instructions (both optional). Only asks for whatever is still missing —
// never guesses or fills in a default for missing information.
function setDeliveryDetails(order, { name, phone, address, apartmentUnit, instructions }) {
  const fields = { name, phone, address, apartmentUnit, instructions };
  for (const [field, value] of Object.entries(fields)) {
    if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
      return { error: `${field} must be a non-empty string.` };
    }
  }

  if (name !== undefined) order.customer.name = name.trim();
  if (phone !== undefined) order.customer.phone = phone.trim();
  // Changing the address itself invalidates any prior confirmation of it.
  if (address !== undefined) {
    order.deliveryAddress.address = address.trim();
    order.deliveryAddress.confirmed = false;
  }
  if (apartmentUnit !== undefined) {
    order.deliveryAddress.apartmentUnit = apartmentUnit.trim();
    order.deliveryAddress.confirmed = false;
  }
  if (instructions !== undefined) order.deliveryAddress.instructions = instructions.trim();

  order.orderType = "delivery";
  recalculateTotal(order); // orderType affects deliveryFee

  const missing = [];
  if (!order.customer.name) missing.push("your name");
  if (!order.customer.phone) missing.push("a phone number");
  if (!order.deliveryAddress.address) missing.push("your full delivery address");

  if (missing.length > 0) {
    return { needsClarification: true, reply: `I still need ${missing.join(", ")} for delivery.` };
  }

  if (!order.deliveryAddress.confirmed) {
    return {
      needsConfirmation: true,
      reply: `Please confirm your delivery address: ${formatDeliveryAddress(order)}. ` +
        "Reply to confirm, or send a correction.",
    };
  }

  let reply = `Got it — delivery order for ${order.customer.name} at ${order.deliveryAddress.address}`;
  if (order.deliveryAddress.apartmentUnit) {
    reply += `, ${order.deliveryAddress.apartmentUnit}`;
  }
  reply += ".";
  if (order.deliveryAddress.instructions) {
    reply += ` Instructions: ${order.deliveryAddress.instructions}.`;
  }

  return { reply };
}

function formatDeliveryAddress(order) {
  const { address, apartmentUnit } = order.deliveryAddress;
  return apartmentUnit ? `${address}, ${apartmentUnit}` : address;
}

// Explicitly confirms the delivery address exactly as currently stored.
// Required before checkout for delivery orders — any correction must go
// through setDeliveryDetails, which resets this back to unconfirmed.
function confirmDeliveryAddress(order) {
  if (order.orderType !== "delivery") {
    return { error: "This order is not set to delivery." };
  }
  if (!order.deliveryAddress.address) {
    return { error: "No delivery address has been provided yet." };
  }

  order.deliveryAddress.confirmed = true;
  return { reply: `Confirmed — delivering to ${formatDeliveryAddress(order)}.` };
}

// Deliberately narrow, explicit whitelist — anything not an exact match here
// is treated as ambiguous and must never be read as confirmation.
const CONFIRMATION_PHRASES = new Set([
  "yes", "y", "yes please", "please yes", "yep", "yeah", "yup",
  "confirm", "confirmed", "i confirm", "yes confirm", "yes confirmed",
  "correct", "that's correct", "thats correct", "that is correct",
  "looks good", "that looks good", "sounds good",
  "go ahead", "yes go ahead",
  "place the order", "place my order", "yes place the order",
  "submit the order", "confirm the order", "confirm order",
  "please confirm", "please confirm the order",
]);

function isExplicitConfirmation(text) {
  if (typeof text !== "string") return false;
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.,!?]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return CONFIRMATION_PHRASES.has(normalized);
}

// data/orders.json holds real customer data (name, phone, address) once the
// app is used, so it's gitignored — tolerate it not existing on a fresh
// deploy/clone instead of crashing on the first order-related request.
function readSavedOrders() {
  let raw;
  try {
    raw = fs.readFileSync(ORDERS_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return raw.trim().length === 0 ? [] : JSON.parse(raw);
}

// Appends a confirmed order to data/orders.json with a unique ID and
// timestamp. Only ever called after the confirmation gate has passed —
// never for a draft/"building" order.
function writeSavedOrders(orders) {
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
}

function saveConfirmedOrder(sessionId, order) {
  // Assign the ID before snapshotting so the saved copy is self-consistent.
  order.orderId = crypto.randomUUID();

  const record = {
    orderId: order.orderId,
    sessionId,
    createdAt: new Date().toISOString(),
    status: "confirmed",
    order: JSON.parse(JSON.stringify(order)),
  };

  const orders = readSavedOrders();
  orders.push(record);
  writeSavedOrders(orders);

  return record;
}

// The only gate that may mark an order confirmed/finalized. Requires an
// explicit, unambiguous confirmation reply from the customer after they've
// reviewed the final (ready-for-checkout) summary — anything else, including
// silence or an unclear reply, leaves the order unconfirmed and unsaved.
function confirmOrder(order, customerReply, sessionId) {
  if (order.confirmed) {
    return { reply: "Your order is already confirmed." };
  }

  const review = buildOrderReview(order);
  if (!review.readyForCheckout.ready) {
    return { error: `Cannot confirm yet — ${review.readyForCheckout.blockers.join("; ")}.` };
  }

  if (!isExplicitConfirmation(customerReply)) {
    return {
      needsConfirmation: true,
      reply:
        "I didn't catch a clear yes — please review the summary and reply with an explicit " +
        'confirmation (e.g. "yes, confirm") to place the order, or let me know what to change.',
    };
  }

  order.confirmed = true;
  order.status = "confirmed";

  const saved = saveConfirmedOrder(sessionId, order);

  return { reply: `Your order is confirmed! Order #${saved.orderId}. ${summarizeOrderReview(order).reply}` };
}

function resolveSessionId(sessionId) {
  if (sessionId !== undefined && typeof sessionId !== "string") {
    return { error: "sessionId must be a string." };
  }
  return { sessionId: sessionId || crypto.randomUUID() };
}

app.post("/api/chat", (req, res) => {
  const { message, history = [], sessionId } = req.body || {};

  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "message is required and must be a non-empty string." });
  }

  if (!Array.isArray(history)) {
    return res.status(400).json({ error: "history must be an array of prior messages." });
  }

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);

  // Order-modifying tools are not wired into chat yet — see POST /api/order/items.
  const messages = buildMessages(history, message);
  const reply = getMockReply(messages);

  res.json({ reply, sessionId: activeSessionId, order });
});

// Returns the full menu so the frontend can render it. Read-only.
app.get("/api/menu", (req, res) => {
  res.json({ items: MENU.items });
});

// Adds one valid menu item to the current session's order.
// Does not support checkout yet.
app.post("/api/order/items", (req, res) => {
  const { sessionId, itemId, size, quantity, options } = req.body || {};

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);

  const result = addItemToOrder(order, { itemId, size, quantity, options });

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ reply: result.reply, sessionId: activeSessionId, order });
});

// Modifies quantity, size, and/or options on an existing order item.
// Does not support checkout yet.
app.patch("/api/order/items/:lineId", (req, res) => {
  const { sessionId, quantity, size, options } = req.body || {};
  const { lineId } = req.params;

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);

  const result = updateOrderItemInOrder(order, lineId, { quantity, size, options });

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ reply: result.reply, sessionId: activeSessionId, order });
});

// Removes an order item entirely, or reduces its quantity by an optional
// amount (removing the line once its quantity reaches zero). Does not
// support checkout yet.
app.delete("/api/order/items/:lineId", (req, res) => {
  const { sessionId, quantity } = req.body || {};
  const { lineId } = req.params;

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);

  const result = removeOrderItemFromOrder(order, lineId, { quantity });

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ reply: result.reply, sessionId: activeSessionId, order });
});

// Returns a concise, human-readable summary of the current session's order.
app.get("/api/order/summary", (req, res) => {
  const { sessionId } = req.query;

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);
  const summary = summarizeOrder(order);

  res.json({ reply: summary, sessionId: activeSessionId, order });
});

// Returns up to 1-2 available menu items to recommend for the current order.
app.get("/api/menu/recommendations", (req, res) => {
  const { sessionId } = req.query;

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);
  const { picks, reply } = summarizeRecommendations(order);

  res.json({ reply, sessionId: activeSessionId, recommendations: picks, order });
});

// Returns active promotions whose eligibility rules the current order satisfies.
app.get("/api/promotions/eligible", (req, res) => {
  const { sessionId } = req.query;

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);
  const { eligible, reply } = summarizeEligiblePromotions(order);

  res.json({ reply, sessionId: activeSessionId, eligiblePromotions: eligible, order });
});

// Applies a promotion to the order. Only active, currently-eligible promotions are accepted.
app.post("/api/order/promotion", (req, res) => {
  const { sessionId, promotionId } = req.body || {};

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);

  const result = applyPromotionToOrder(order, promotionId);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ reply: result.reply, sessionId: activeSessionId, order });
});

// Selects pickup as the order type and collects the customer's name
// (required) and pickup time (optional), ahead of checkout.
app.post("/api/order/pickup", (req, res) => {
  const { sessionId, name, pickupTime } = req.body || {};

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);

  const result = setPickupDetails(order, { name, pickupTime });

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ reply: result.reply, sessionId: activeSessionId, order });
});

// Selects delivery as the order type and collects name, phone, full address
// (all required), plus apartment/unit and delivery instructions (optional).
app.post("/api/order/delivery", (req, res) => {
  const { sessionId, name, phone, address, apartmentUnit, instructions } = req.body || {};

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);

  const result = setDeliveryDetails(order, { name, phone, address, apartmentUnit, instructions });

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ reply: result.reply, sessionId: activeSessionId, order });
});

// Explicitly confirms the delivery address as-is. Required before checkout
// for delivery orders — send a correction via POST /api/order/delivery instead.
app.post("/api/order/delivery/confirm-address", (req, res) => {
  const { sessionId } = req.body || {};

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);

  const result = confirmDeliveryAddress(order);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ reply: result.reply, sessionId: activeSessionId, order });
});

// Returns the complete structured pre-checkout order summary: items,
// customizations, fulfillment details, valid promotions, and total.
app.get("/api/order/review", (req, res) => {
  const { sessionId } = req.query;

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);
  const { review, reply } = summarizeOrderReview(order);

  res.json({ reply, sessionId: activeSessionId, review, order });
});

// Confirms and finalizes the order. Requires an explicit, unambiguous
// confirmation reply — the only way order.confirmed/status ever become true.
app.post("/api/order/confirm", (req, res) => {
  const { sessionId, customerReply } = req.body || {};

  if (typeof customerReply !== "string" || customerReply.trim().length === 0) {
    return res.status(400).json({ error: "customerReply is required and must be a non-empty string." });
  }

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);

  const result = confirmOrder(order, customerReply, activeSessionId);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ reply: result.reply, sessionId: activeSessionId, order });
});

const STAFF_ORDER_STATUSES = ["confirmed", "preparing", "ready", "completed", "cancelled"];

// Constant-time string comparison (via equal-length digests) so login
// attempts can't be timed to guess the username/password character by character.
function timingSafeStringEqual(a, b) {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// Gatekeeper for all /api/staff/* routes. Requires HTTP Basic Auth matching
// STAFF_USERNAME/STAFF_PASSWORD from .env — fails closed (503) if those
// aren't configured, rather than allowing the dashboard through unprotected.
function requireStaffAuth(req, res, next) {
  if (!STAFF_USERNAME || !STAFF_PASSWORD) {
    return res.status(503).json({ error: "Staff auth is not configured on the server." });
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme !== "Basic" || !encoded) {
    res.set("WWW-Authenticate", 'Basic realm="CafeBot Staff"');
    return res.status(401).json({ error: "Authentication required." });
  }

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  const user = separatorIndex === -1 ? decoded : decoded.slice(0, separatorIndex);
  const pass = separatorIndex === -1 ? "" : decoded.slice(separatorIndex + 1);

  if (!timingSafeStringEqual(user, STAFF_USERNAME) || !timingSafeStringEqual(pass, STAFF_PASSWORD)) {
    res.set("WWW-Authenticate", 'Basic realm="CafeBot Staff"');
    return res.status(401).json({ error: "Invalid credentials." });
  }

  next();
}

// Returns all saved (confirmed) orders for the staff dashboard.
app.get("/api/staff/orders", requireStaffAuth, (req, res) => {
  res.json({ orders: readSavedOrders() });
});

// Updates a saved order's status (e.g. confirmed -> preparing -> ready -> completed).
app.patch("/api/staff/orders/:orderId", requireStaffAuth, (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body || {};

  if (typeof status !== "string" || !STAFF_ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STAFF_ORDER_STATUSES.join(", ")}.` });
  }

  const orders = readSavedOrders();
  const record = orders.find((o) => o.orderId === orderId);
  if (!record) {
    return res.status(400).json({ error: `Order '${orderId}' was not found.` });
  }

  record.status = status;
  writeSavedOrders(orders);

  res.json({ order: record });
});

app.listen(PORT, () => {
  console.log(`CafeBot backend listening on http://localhost:${PORT}`);
});
