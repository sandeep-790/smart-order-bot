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
const DELIVERY_FEE = 40; // flat fee (INR), applied only to orderType "delivery"

// AI provider — any OpenAI-compatible chat completions API (Gemini, Groq,
// OpenRouter, etc. all work). Without AI_API_KEY set, /api/chat replies
// with a clear "not configured" message instead of crashing.
const AI_API_BASE_URL = (process.env.AI_API_BASE_URL || "").replace(/\/+$/, "");
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "";
if (!AI_API_KEY) {
  console.warn(
    "Warning: AI_API_KEY is not set in .env — /api/chat will reply with a " +
    "placeholder message instead of calling a real AI provider."
  );
}

// Text-to-speech for RoboCap's chat replies — Sarvam AI's Bulbul model
// (natural Indian-English voices). Called server-side only so the API key
// is never exposed to the browser. Without SARVAM_API_KEY set, /api/tts
// fails closed with a clear error instead of crashing.
const SARVAM_API_KEY = process.env.SARVAM_API_KEY || "";
// Sarvam's speaker names are case-sensitive lowercase (e.g. "ritu", not
// "Ritu") — normalize so a differently-cased value in .env fails softly
// instead of 400ing every request.
const SARVAM_TTS_SPEAKER = (process.env.SARVAM_TTS_SPEAKER || "shubh").toLowerCase();
const SARVAM_TTS_MODEL = process.env.SARVAM_TTS_MODEL || "bulbul:v3";
const SARVAM_TTS_MAX_CHARS = 3500; // Sarvam's own limit for bulbul:v3 on the streaming API
if (!SARVAM_API_KEY) {
  console.warn(
    "Warning: SARVAM_API_KEY is not set in .env — /api/tts will return an " +
    "error and the frontend will just stay silent instead of speaking replies."
  );
}

// The chat bubble's text is written for reading (markdown, parentheses,
// abbreviations like "pcs"), not for a voice to read aloud — e.g. "Idli
// (4 pcs)" should be spoken as "Idli, 4 pieces", not read literally
// symbol-by-symbol. Runs server-side so there's one definition, not one
// per caller.
function normalizeTextForSpeech(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1") // strip markdown bold
    .replace(/^\s*[*-]\s+/gm, "") // strip leading "* "/"- " bullet markers
    .replace(/\b(\d+)\s?x\s+/gi, "$1 quantity of ") // "2x Medu Vada" -> "2 quantity of Medu Vada", not "2 times ..."
    .replace(/₹\s?(\d+(?:\.\d+)?)/g, "$1 rupees") // ₹80 -> "80 rupees"
    .replace(/\(/g, ", ") // parenthetical asides read as a natural spoken pause
    .replace(/\)/g, "")
    .replace(/\bpcs\b\.?/gi, "pieces")
    .replace(/\bpc\b\.?/gi, "piece")
    .replace(/,\s*,/g, ",") // collapse doubled commas left by nested parens
    .replace(/\s+,/g, ",") // drop the stray space the "(" -> ", " swap leaves before it
    .replace(/\s+/g, " ")
    .trim();
}

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

// Serves the frontend (index.html, staff.html, app.js, style.css, ...) from
// this same server/origin — visit "/" for the chat UI, "/staff.html" for
// the staff dashboard. Falls through to the API routes below for anything
// that isn't a static file.
const FRONTEND_PATH = path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_PATH));

function buildMessages(history, message) {
  const activePromotions = PROMOTIONS.promotions.filter((p) => p.active);

  const systemContent =
    `${SYSTEM_PROMPT}\n\n` +
    "## Menu Data\n" +
    "This is the only source of truth for menu items, prices, and availability — " +
    "a JSON array below. All prices are in Indian Rupees (INR). When stating a " +
    "price, copy the exact number from this data and prefix it with the ₹ symbol " +
    "(e.g. ₹60), never $ or any other currency. Never invent an item, price, or " +
    "size that isn't literally present in this JSON — if you're not sure an item " +
    "exists, say you're not sure rather than guessing.\n\n" +
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

// Tool definitions for AI function-calling — one per order-modifying or
// order-reading backend action. Each maps directly onto an existing,
// already-validated function; the tools add no new business logic of
// their own, just a dispatch layer.
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_menu_items",
      description:
        "Search the menu by name/keyword. ALWAYS call this first when the customer's wording doesn't " +
        "exactly match a known itemId, or when more than one item could match — then show the results " +
        "as a choice for the customer to pick from. Never guess an itemId for add_item_to_order.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What the customer said they want, e.g. 'dosa' or 'egg curry'." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_item_to_order",
      description:
        "Add one valid menu item to the customer's order, only after you're certain of the exact itemId " +
        "(use search_menu_items first if not certain). If the item has more than one size and none is " +
        "given, or has a required add-on group that isn't satisfied, this returns a clarifying question " +
        "instead of adding it — show the customer the returned choices and call again with their answer.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "string", description: "The menu item's exact id, e.g. 'dosa-plain'." },
          size: { type: "string", description: "Size name, required only if the item offers more than one size." },
          quantity: { type: "integer", description: "How many to add. Defaults to 1." },
          options: { type: "array", items: { type: "string" }, description: "Free-form customization names from the item's own options list." },
          addOns: {
            type: "array",
            items: { type: "string" },
            description: "Selected add-on option names from the item's addOnGroups, if it has any. Required groups must be satisfied or this asks a clarifying question instead of adding.",
          },
          notes: { type: "string", description: "Optional item-level special instruction from the customer, e.g. 'less spicy'." },
        },
        required: ["itemId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_order_item",
      description: "Change the quantity, size, options, add-ons, and/or notes of an item already in the order.",
      parameters: {
        type: "object",
        properties: {
          lineId: { type: "string", description: "The order line's lineId, from the current order state." },
          quantity: { type: "integer" },
          size: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          addOns: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
        },
        required: ["lineId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_order_item",
      description: "Remove an item from the order entirely, or reduce its quantity by a given amount.",
      parameters: {
        type: "object",
        properties: {
          lineId: { type: "string", description: "The order line's lineId, from the current order state." },
          quantity: { type: "integer", description: "Amount to reduce by. Omit to remove the line entirely." },
        },
        required: ["lineId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_promotion",
      description: "Apply a promotion to the order. Only succeeds if it's active and its eligibility rules are currently met.",
      parameters: {
        type: "object",
        properties: {
          promotionId: { type: "string" },
        },
        required: ["promotionId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "present_fulfillment_options",
      description:
        "Call this to ask the customer whether they want pickup, delivery, or dine-in — returns " +
        "tappable choices instead of you having to ask them to type it.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "set_pickup_details",
      description: "Select pickup and set the customer's name (required) and pickup time (optional). Call with only the fields the customer just gave you.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          pickupTime: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_delivery_details",
      description:
        "Select delivery and set name, phone, and address (all required), plus apartment/unit and " +
        "instructions (optional). Call with only the fields the customer just gave you. Once all " +
        "required fields are set, this returns a delivery address that must be read back and confirmed " +
        "with confirm_delivery_address before checkout.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          address: { type: "string" },
          apartmentUnit: { type: "string" },
          instructions: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_delivery_address",
      description: "Confirms the delivery address exactly as currently stored, after the customer has explicitly agreed it's correct.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "set_dine_in_details",
      description: "Select dine-in and set the customer's name and phone number (both required). Call with only the fields the customer just gave you.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_order_notes",
      description:
        "Sets an order-level special instruction the customer wants to add for the whole order " +
        "(not tied to one item), e.g. 'please pack separately'. Ask about this before confirm_order " +
        "if it hasn't been set yet — don't assume there's nothing to add.",
      parameters: {
        type: "object",
        properties: {
          notes: { type: "string" },
        },
        required: ["notes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_review",
      description: "Returns the complete order summary — items, fulfillment, promotions, price breakdown, and whether it's ready for checkout.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recommendations",
      description: "Returns up to 5 available menu items to suggest to the customer.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bestsellers",
      description: "Returns the cafe's curated bestseller items. Always use this for \"bestsellers\" / \"popular\" / \"most ordered\" questions instead of guessing from the full menu.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_chefs_recommendations",
      description: "Returns the cafe's curated chef's-recommendation items. Always use this for \"chef's recommendation\" / \"what's special\" questions instead of guessing from the full menu.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_spicy_items",
      description: "Returns available items tagged as genuinely spicy/chili-forward. Always use this for \"spicy dishes\" questions instead of text-searching for the word \"spicy\" — most spicy items don't have that word in their name.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_vegetarian_items",
      description: "Returns up to 10 available vegetarian items. Always use this for \"vegetarian options\" questions instead of guessing from the full menu, so the items you describe exactly match the quick-reply cards shown.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_non_vegetarian_items",
      description: "Returns up to 10 available non-vegetarian items. Always use this for \"non-vegetarian options\" questions instead of guessing from the full menu, so the items you describe exactly match the quick-reply cards shown.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "present_quantity_options",
      description:
        "Call this to ask the customer how many of an item they'd like, when you're about to add more " +
        "than 1 and they haven't stated a number themselves — returns tappable quantity choices instead " +
        "of you deciding a quantity for them.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "present_notes_options",
      description:
        "Call this to ask the customer if they'd like any special instructions for the order (e.g. " +
        "packing separately) — returns tappable choices instead of you asking them to type it.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_items",
      description:
        "Compare two menu items side by side. Both itemIds must be exact — use search_menu_items first " +
        "for either name that isn't already an unambiguous match. Returns both full items for the " +
        "customer to see as cards; you then briefly say what each is best for and recommend one.",
      parameters: {
        type: "object",
        properties: {
          itemId1: { type: "string", description: "Exact itemId of the first item." },
          itemId2: { type: "string", description: "Exact itemId of the second item." },
        },
        required: ["itemId1", "itemId2"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_eligible_promotions",
      description: "Returns active promotions the current order is currently eligible for.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "present_confirmation_options",
      description:
        "Call this alongside get_order_review, once the order is ready for checkout, to ask the " +
        "customer to confirm — returns tappable Yes/No choices instead of you having to ask them to type it.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_order",
      description:
        "Finalizes and saves the order. Only call this after the customer has given an explicit, " +
        "unambiguous confirmation (e.g. 'yes', 'confirm') in response to the final order summary — " +
        "never for an ambiguous reply like 'ok' or 'sure'. Pass their exact words; the system " +
        "independently re-checks that the reply is genuinely unambiguous and will refuse otherwise.",
      parameters: {
        type: "object",
        properties: {
          customerReplyText: { type: "string", description: "The customer's own message confirming the order, verbatim." },
        },
        required: ["customerReplyText"],
      },
    },
  },
];

// Dispatches one AI tool call onto the matching, already-validated backend
// function. Returns a plain object (JSON-serialized back to the model) —
// never throws for a bad call, since the model needs to see errors to
// self-correct on the next turn.
function executeTool(name, args, order, activeSessionId) {
  switch (name) {
    case "search_menu_items": {
      const matches = searchMenuItems(args.query);
      if (matches.length === 0) {
        return { matches: [], reply: `I couldn't find anything matching "${args.query}" on the menu.` };
      }
      return {
        matches: matches.map((m) => ({ id: m.id, name: m.name, category: m.category, price: m.sizes[0].price })),
        quickReplies: buildItemQuickReplies(matches),
      };
    }
    case "add_item_to_order":
      return addItemToOrder(order, args);
    case "update_order_item":
      return updateOrderItemInOrder(order, args.lineId, args);
    case "remove_order_item":
      return removeOrderItemFromOrder(order, args.lineId, args);
    case "apply_promotion":
      return applyPromotionToOrder(order, args.promotionId);
    case "present_fulfillment_options":
      return { reply: "Would you like pickup, delivery, or dine-in?", quickReplies: ["Pickup", "Delivery", "Dine-in"] };
    case "set_pickup_details":
      return setPickupDetails(order, args);
    case "set_delivery_details":
      return setDeliveryDetails(order, args);
    case "confirm_delivery_address":
      return confirmDeliveryAddress(order);
    case "set_dine_in_details":
      return setDineInDetails(order, args);
    case "set_order_notes":
      return setOrderNotes(order, args.notes);
    case "get_order_review":
      return { review: buildOrderReview(order) };
    case "get_recommendations": {
      const picks = getRecommendations(order);
      return { recommendations: picks, quickReplies: buildItemQuickReplies(picks, { recommended: true }) };
    }
    case "get_bestsellers": {
      const picks = MENU.items.filter((item) => item.bestseller && item.available);
      return { bestsellers: picks, quickReplies: buildItemQuickReplies(picks) };
    }
    case "get_chefs_recommendations": {
      const picks = MENU.items.filter((item) => item.chefRecommended && item.available);
      return { chefsRecommendations: picks, quickReplies: buildItemQuickReplies(picks) };
    }
    case "get_spicy_items": {
      const picks = MENU.items.filter((item) => item.spicy && item.available);
      return { spicyItems: picks, quickReplies: buildItemQuickReplies(picks) };
    }
    case "get_vegetarian_items": {
      const picks = MENU.items.filter((item) => item.dietary.includes("vegetarian") && item.available).slice(0, 10);
      return { vegetarianItems: picks, quickReplies: buildItemQuickReplies(picks) };
    }
    case "get_non_vegetarian_items": {
      const picks = MENU.items.filter((item) => item.dietary.includes("non-vegetarian") && item.available).slice(0, 10);
      return { nonVegetarianItems: picks, quickReplies: buildItemQuickReplies(picks) };
    }
    case "present_quantity_options":
      return { reply: "How many would you like?", quickReplies: ["1", "2", "3", "4"] };
    case "present_notes_options":
      return {
        reply: "Would you like any special instructions for your order?",
        quickReplies: ["Pack items separately", "No special instructions", "Something else"],
      };
    case "compare_items": {
      const item1 = MENU.items.find((m) => m.id === args.itemId1);
      const item2 = MENU.items.find((m) => m.id === args.itemId2);
      if (!item1 || !item2) {
        const missing = [!item1 ? args.itemId1 : null, !item2 ? args.itemId2 : null].filter(Boolean);
        return { error: `Item id(s) not found: ${missing.join(", ")}. Use search_menu_items to find the correct id.` };
      }
      return { items: [item1, item2], quickReplies: buildItemQuickReplies([item1, item2]), isComparison: true };
    }
    case "get_eligible_promotions":
      return { eligiblePromotions: getEligiblePromotions(order) };
    case "present_confirmation_options":
      return {
        reply: "Shall I place the order?",
        quickReplies: ["Yes, confirm", "No, let me change something"],
        isOrderSummary: true,
      };
    case "confirm_order":
      return confirmOrder(order, args.customerReplyText, activeSessionId);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function callAiApi(messages) {
  const res = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({ model: AI_MODEL, messages, tools: TOOLS, tool_choice: "auto" }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`AI provider request failed (${res.status}): ${bodyText.slice(0, 300)}`);
  }

  return res.json();
}

const MAX_TOOL_CALL_STEPS = 6;

// Runs one full chat turn: sends the conversation (+ live order state) to
// the AI, executes any tool calls it requests against the real order, and
// repeats until it responds with plain text or a safety cap is hit.
async function runAiTurn(history, message, order, activeSessionId) {
  if (!AI_API_KEY) {
    return { reply: "AI isn't configured yet on this server — set AI_API_KEY (and AI_API_BASE_URL/AI_MODEL) in .env." };
  }

  const conversation = buildMessages(history, message);
  let quickReplies = null;
  let isComparison = false;
  let isOrderSummary = false;
  let orderJustConfirmed = false;

  for (let step = 0; step < MAX_TOOL_CALL_STEPS; step++) {
    // Small models tend to narrate a running quantity ("now you have 2")
    // from conversational momentum rather than actually counting the JSON
    // array below — so hand them the exact count pre-computed, in the
    // cheapest possible form to get right.
    const cartQuantityLine =
      order.items.length === 0
        ? "The cart is currently EMPTY — 0 items."
        : order.items.map((i) => `${i.quantity} x ${i.name} (${i.size})`).join("; ");

    // Merged into ONE system message, not two — some OpenAI-compatible
    // providers (confirmed: Gemini) silently drop system content when more
    // than one system-role message is present, instead of concatenating them.
    const mergedSystem = {
      role: "system",
      content:
        `${conversation[0].content}\n\n` +
        `## Current Order State (live — reflects everything set so far)\n` +
        `EXACT cart quantities right now — this is the only correct answer to "how many does the customer have", ` +
        `it is NOT necessarily what you said a moment ago: ${cartQuantityLine}\n\n` +
        JSON.stringify(order, null, 2),
    };

    let data;
    try {
      data = await callAiApi([mergedSystem, ...conversation.slice(1)]);
    } catch (err) {
      return { reply: "Sorry, I couldn't reach the AI service just now. Please try again in a moment." };
    }

    const assistantMessage = data.choices && data.choices[0] && data.choices[0].message;
    if (!assistantMessage) {
      return { reply: "Sorry, I didn't get a usable response — please try again." };
    }

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      return { reply: assistantMessage.content || "", quickReplies, isComparison, isOrderSummary, orderJustConfirmed };
    }

    conversation.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch (err) {
        args = {};
      }

      const result = executeTool(toolCall.function.name, args, order, activeSessionId);

      // The most recent tool result carrying quickReplies wins — that's
      // the choice actually relevant to what the customer should do next.
      // isComparison/isOrderSummary ride along with it so a stale flag from
      // an earlier tool call in this same turn can't leak into a later,
      // unrelated one.
      if (result.quickReplies) {
        quickReplies = result.quickReplies;
        isComparison = Boolean(result.isComparison);
        isOrderSummary = Boolean(result.isOrderSummary);
      }
      if (result.orderConfirmed) orderJustConfirmed = true;

      conversation.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  return { reply: "Sorry, that's taking longer than expected — could you rephrase or try again?" };
}

// In-memory order state, keyed by sessionId. No database — state is lost on server restart.
const orderSessions = new Map();

function createEmptyOrder() {
  return {
    items: [], // [{ itemId, name, quantity, options, addOns, notes, unitPrice }]
    orderType: null, // "pickup" | "delivery" | "dine_in" | null
    customer: { name: null, phone: null },
    pickupTime: null, // optional, freeform (e.g. "ASAP", "3:30 PM")
    deliveryAddress: { address: null, apartmentUnit: null, instructions: null, confirmed: false },
    promotionId: null,
    notes: null, // order-level special instructions
    subtotal: 0, // sum of (unitPrice + addOns) * quantity, before discount/tax/fee
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

// A line's per-unit price including any selected add-ons.
function getItemUnitPriceWithAddOns(item) {
  const addOnsTotal = (item.addOns || []).reduce((sum, a) => sum + a.priceDelta, 0);
  return item.unitPrice + addOnsTotal;
}

function getOrderSubtotal(order) {
  return order.items.reduce((sum, item) => sum + getItemUnitPriceWithAddOns(item) * item.quantity, 0);
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
    return { eligible: false, reason: `requires a minimum order of ₹${e.minOrderValue.toFixed(2)}` };
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
      .reduce((sum, item) => sum + getItemUnitPriceWithAddOns(item) * item.quantity, 0);
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
    const addOnNames = (item.addOns || []).map((a) => a.name);
    const addOnNote = addOnNames.length > 0 ? `, ${addOnNames.join(", ")}` : "";
    return `${item.quantity}x ${item.name} (${item.size}${customizations}${addOnNote})`;
  });

  const priceParts = [`Subtotal: ₹${order.subtotal.toFixed(2)}`];
  if (order.discount > 0) priceParts.push(`Discount: -₹${order.discount.toFixed(2)}`);
  priceParts.push(`Tax: ₹${order.tax.toFixed(2)}`);
  if (order.deliveryFee > 0) priceParts.push(`Delivery fee: ₹${order.deliveryFee.toFixed(2)}`);
  priceParts.push(`Total: ₹${order.total.toFixed(2)}`);

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

  // Prefer items from categories the customer hasn't ordered from yet, but
  // pad with the rest of the available menu if that alone can't fill 5.
  const ranked = complementary.length >= 5 ? complementary : [...complementary, ...available.filter((item) => !complementary.includes(item))];
  return ranked.slice(0, 5);
}

// Finds available menu items whose name matches a customer's (possibly
// imprecise) wording. The AI must use this — and show the results as a
// choice — instead of guessing an itemId when the wording doesn't exactly
// match one item. Simple substring/word-overlap scoring, no ML/service.
function searchMenuItems(query) {
  if (typeof query !== "string" || query.trim().length === 0) return [];

  const normalizedQuery = query.trim().toLowerCase();
  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);

  const scored = MENU.items
    .filter((item) => item.available)
    .map((item) => {
      const name = item.name.toLowerCase();
      let score = 0;
      if (name === normalizedQuery) score = 100;
      else if (name.includes(normalizedQuery)) score = 80;
      else if (queryWords.some((w) => w.length > 2 && name.includes(w))) score = 50;
      else if (item.category.toLowerCase().includes(normalizedQuery)) score = 20;
      return { item, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 10).map((s) => s.item);
}

// Renders a list of menu items as rich quick-reply cards (image + price),
// so the frontend can show a tappable, image-and-select list instead of
// the AI (or the customer) having to type an exact item name.
function buildItemQuickReplies(items, options = {}) {
  return items.map((item) => ({
    label: item.name,
    value: `I'd like to add ${item.name}`,
    image: item.image || null,
    price: item.sizes[0].price,
    itemId: item.id,
    description: item.description || "",
    dietary: item.dietary || [],
    bestseller: Boolean(item.bestseller),
    spicy: Boolean(item.spicy),
    chefRecommended: Boolean(item.chefRecommended),
    recommended: Boolean(options.recommended),
  }));
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
    addOns: item.addOns || [],
    notes: item.notes || null,
    unitPrice: item.unitPrice,
    lineTotal: round2(getItemUnitPriceWithAddOns(item) * item.quantity),
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
  } else if (order.orderType === "dine_in") {
    fulfillment = { type: "dine_in", name: order.customer.name, phone: order.customer.phone };
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
  if (!order.orderType) blockers.push("fulfillment method (pickup, delivery, or dine-in) not selected");
  if (order.orderType === "pickup" && !order.customer.name) {
    blockers.push("missing customer name");
  }
  if (order.orderType === "delivery") {
    if (!order.customer.name) blockers.push("missing customer name");
    if (!order.customer.phone) blockers.push("missing phone number");
    if (!order.deliveryAddress.address) blockers.push("missing delivery address");
    else if (!order.deliveryAddress.confirmed) blockers.push("delivery address not yet confirmed");
  }
  if (order.orderType === "dine_in") {
    if (!order.customer.name) blockers.push("missing customer name");
    if (!order.customer.phone) blockers.push("missing phone number");
  }

  return {
    items,
    fulfillment,
    notes: order.notes,
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
    const addOnNames = (item.addOns || []).map((a) => a.name);
    const addOnNote = addOnNames.length > 0 ? `, ${addOnNames.join(", ")}` : "";
    const noteText = item.notes ? ` [note: ${item.notes}]` : "";
    return `${item.quantity}x ${item.name} (${item.size}${customizations}${addOnNote})${noteText}`;
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
  } else if (review.fulfillment.type === "dine_in") {
    parts.push(`Dine-in for ${review.fulfillment.name || "(name needed)"}, ${review.fulfillment.phone || "(phone needed)"}`);
  } else {
    parts.push("Fulfillment method not yet selected");
  }

  if (review.notes) {
    parts.push(`Order note: ${review.notes}`);
  }

  if (review.promotions.applied) {
    parts.push(`Applied promotion: ${review.promotions.applied.name}`);
  }

  const p = review.pricing;
  const priceBits = [`Subtotal: ₹${p.subtotal.toFixed(2)}`];
  if (p.discount > 0) priceBits.push(`Discount: -₹${p.discount.toFixed(2)}`);
  priceBits.push(`Tax: ₹${p.tax.toFixed(2)}`);
  if (p.deliveryFee > 0) priceBits.push(`Delivery fee: ₹${p.deliveryFee.toFixed(2)}`);
  priceBits.push(`Total: ₹${p.total.toFixed(2)}`);
  parts.push(priceBits.join(", "));

  if (!review.readyForCheckout.ready) {
    parts.push(`Still needed before checkout: ${review.readyForCheckout.blockers.join("; ")}`);
  }

  return { review, reply: `${parts.join(". ")}.` };
}

// Adds one valid menu item to the order. Returns either an added item, a
// clarifying question (missing/invalid size), or a hard validation error.
function addItemToOrder(order, { itemId, size, quantity, options, addOns, notes }) {
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
    const sizeNames = menuItem.sizes.map((s) => s.name);
    return {
      needsClarification: true,
      reply: `What size would you like for ${menuItem.name}? Choose from: ${sizeNames.join(", ")}.`,
      quickReplies: sizeNames,
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

  const addOnsResult = validateAddOnSelections(menuItem, addOns);
  if (addOnsResult.error || addOnsResult.needsClarification) {
    return addOnsResult;
  }

  if (notes !== undefined && typeof notes !== "string") {
    return { error: "notes must be a string." };
  }

  order.items.push({
    lineId: crypto.randomUUID(),
    itemId: menuItem.id,
    name: menuItem.name,
    size: chosenSize.name,
    quantity: qty,
    options: normalizedOptions,
    addOns: addOnsResult.addOns,
    notes: notes ? notes.trim() : null,
    unitPrice: chosenSize.price,
  });
  recalculateTotal(order);

  const addOnNote = addOnsResult.addOns.length > 0 ? ` with ${addOnsResult.addOns.map((a) => a.name).join(", ")}` : "";
  return {
    reply: `Added ${qty} x ${menuItem.name} (${chosenSize.name})${addOnNote} to your order.`,
  };
}

// Validates a requested list of add-on option names against a menu item's
// addOnGroups (each group has its own min/max and required flag). Returns
// { addOns: [...] } on success, { error } for an invalid name/count, or
// { needsClarification, reply, quickReplies } if a required group hasn't
// been satisfied yet — never fills in a default choice.
function validateAddOnSelections(menuItem, requestedAddOns) {
  const groups = menuItem.addOnGroups || [];
  const requested = Array.isArray(requestedAddOns) ? requestedAddOns : [];

  if (groups.length === 0) {
    if (requested.length > 0) {
      return { error: `${menuItem.name} has no add-ons available.` };
    }
    return { addOns: [] };
  }

  const matchedByGroup = new Map(groups.map((g) => [g.name, []]));
  const allOptionNames = groups.flatMap((g) => g.options.map((o) => o.name));

  for (const reqName of requested) {
    if (typeof reqName !== "string") {
      return { error: "Each add-on must be a string." };
    }
    let matchedGroup = null;
    let matchedOption = null;
    for (const group of groups) {
      const found = group.options.find((o) => o.name.toLowerCase() === reqName.toLowerCase());
      if (found) {
        matchedGroup = group;
        matchedOption = found;
        break;
      }
    }
    if (!matchedOption) {
      return {
        error: `'${reqName}' is not a valid add-on for ${menuItem.name}. Available add-ons: ${allOptionNames.join(", ") || "none"}.`,
      };
    }
    matchedByGroup.get(matchedGroup.name).push(matchedOption);
  }

  for (const group of groups) {
    const chosen = matchedByGroup.get(group.name);
    if (chosen.length > group.max) {
      return { error: `Choose at most ${group.max} option(s) from '${group.name}' for ${menuItem.name}.` };
    }
    if (group.required && chosen.length < group.min) {
      const optionNames = group.options.map((o) => o.name);
      const countPhrase = group.min === group.max ? `${group.min}` : `${group.min}-${group.max}`;
      return {
        needsClarification: true,
        reply: `Please choose ${countPhrase} option(s) for "${group.name}" on ${menuItem.name}: ${optionNames.join(", ")}.`,
        quickReplies: optionNames,
      };
    }
  }

  const flat = [];
  for (const group of groups) {
    for (const opt of matchedByGroup.get(group.name)) {
      flat.push({ groupName: group.name, name: opt.name, priceDelta: opt.priceDelta });
    }
  }
  return { addOns: flat };
}

// Modifies quantity, size, and/or options on an existing order line item.
// Each provided field is validated against the item's own menu entry.
function updateOrderItemInOrder(order, lineId, { quantity, size, options, addOns, notes }) {
  const item = order.items.find((i) => i.lineId === lineId);
  if (!item) {
    return { error: `Order item '${lineId}' was not found.` };
  }

  if (
    quantity === undefined &&
    size === undefined &&
    options === undefined &&
    addOns === undefined &&
    notes === undefined
  ) {
    return { error: "Provide at least one of quantity, size, options, addOns, or notes to update." };
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

  let addOnsResult;
  if (addOns !== undefined) {
    addOnsResult = validateAddOnSelections(menuItem, addOns);
    if (addOnsResult.error || addOnsResult.needsClarification) {
      return addOnsResult;
    }
  }

  if (notes !== undefined && typeof notes !== "string") {
    return { error: "notes must be a string." };
  }

  if (quantity !== undefined) item.quantity = quantity;
  if (chosenSize !== undefined) {
    item.size = chosenSize.name;
    item.unitPrice = chosenSize.price;
  }
  if (normalizedOptions !== undefined) item.options = normalizedOptions;
  if (addOnsResult !== undefined) item.addOns = addOnsResult.addOns;
  if (notes !== undefined) item.notes = notes.trim() || null;

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

// Selects dine-in as the order type and stores the customer's name and
// phone number (both required). Only asks for whatever is still missing.
function setDineInDetails(order, { name, phone }) {
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return { error: "name must be a non-empty string." };
    }
    order.customer.name = name.trim();
  }

  if (phone !== undefined) {
    if (typeof phone !== "string" || phone.trim().length === 0) {
      return { error: "phone must be a non-empty string." };
    }
    order.customer.phone = phone.trim();
  }

  order.orderType = "dine_in";
  recalculateTotal(order); // orderType affects deliveryFee (none for dine-in)

  const missing = [];
  if (!order.customer.name) missing.push("your name");
  if (!order.customer.phone) missing.push("a phone number");

  if (missing.length > 0) {
    return { needsClarification: true, reply: `I still need ${missing.join(", ")} for dine-in.` };
  }

  return { reply: `Got it — dine-in order for ${order.customer.name}, ${order.customer.phone}.` };
}

// Sets or clears the order-level special instructions note.
function setOrderNotes(order, notes) {
  if (typeof notes !== "string") {
    return { error: "notes must be a string." };
  }
  order.notes = notes.trim() || null;
  return { reply: order.notes ? `Got it — noted: "${order.notes}".` : "Cleared the order note." };
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
  const replyText = `Your order is confirmed! Order #${saved.orderId}. ${summarizeOrderReview(order).reply}`;

  // Cart clears immediately after a successful order — same sessionId,
  // so order history (data/orders.json, filtered by session) keeps
  // accumulating across multiple orders in one browser session.
  resetOrderInPlace(order);

  return { reply: replyText, orderConfirmed: true, orderId: saved.orderId, orderTotal: saved.order.total };
}

// Mutates `order` back to a fresh empty order in place (same object
// reference — callers hold onto `order`, so a plain reassignment wouldn't
// be visible to them).
function resetOrderInPlace(order) {
  Object.assign(order, createEmptyOrder());
}

function resolveSessionId(sessionId) {
  if (sessionId !== undefined && typeof sessionId !== "string") {
    return { error: "sessionId must be a string." };
  }
  return { sessionId: sessionId || crypto.randomUUID() };
}

app.post("/api/chat", async (req, res) => {
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

  const { reply, quickReplies, isComparison, isOrderSummary, orderJustConfirmed } = await runAiTurn(history, message, order, activeSessionId);

  res.json({
    reply,
    sessionId: activeSessionId,
    order,
    quickReplies: quickReplies || null,
    isComparison: Boolean(isComparison),
    isOrderSummary: Boolean(isOrderSummary),
    orderJustConfirmed: Boolean(orderJustConfirmed),
  });
});

// Speaks a chat reply via Sarvam AI's TTS API and streams the audio back.
// Proxied server-side so the API key never reaches the browser. Never
// throws for a missing key/upstream failure — the frontend just skips
// playback silently, since voice is a nice-to-have on top of the chat.
// GET (not POST) so the frontend can point an <audio> element's src
// straight at this route — that's what lets the browser start playing
// before the whole clip has arrived, instead of waiting to buffer a
// complete blob. Uses Sarvam's streaming endpoint and pipes the response
// through chunk by chunk as it arrives, rather than buffering it here
// either, so no hop in the chain adds a "wait for the whole file" delay.
app.get("/api/tts", async (req, res) => {
  const { text } = req.query;

  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "text is required and must be a non-empty string." });
  }

  if (!SARVAM_API_KEY) {
    return res.status(503).json({ error: "Text-to-speech isn't configured on this server — set SARVAM_API_KEY in .env." });
  }

  try {
    const sarvamRes = await fetch("https://api.sarvam.ai/text-to-speech/stream", {
      method: "POST",
      headers: {
        "api-subscription-key": SARVAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: normalizeTextForSpeech(text.slice(0, SARVAM_TTS_MAX_CHARS)),
        language_code: "en-IN",
        speaker: SARVAM_TTS_SPEAKER,
        model: SARVAM_TTS_MODEL,
        output_audio_codec: "mp3",
        enable_preprocessing: true,
      }),
    });

    if (!sarvamRes.ok || !sarvamRes.body) {
      const bodyText = await sarvamRes.text().catch(() => "");
      throw new Error(`Sarvam TTS stream request failed (${sarvamRes.status}): ${bodyText.slice(0, 300)}`);
    }

    res.set("Content-Type", "audio/mpeg");
    const reader = sarvamRes.body.getReader();
    req.on("close", () => reader.cancel().catch(() => {})); // stop upstream if the client navigates away/interrupts
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    console.error("TTS error:", err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: "Text-to-speech is temporarily unavailable." });
    } else {
      res.end();
    }
  }
});

// Returns the full menu so the frontend can render it. Read-only.
app.get("/api/menu", (req, res) => {
  res.json({ items: MENU.items });
});

// Adds one valid menu item to the current session's order.
// Does not support checkout yet.
app.post("/api/order/items", (req, res) => {
  const { sessionId, itemId, size, quantity, options, addOns, notes } = req.body || {};

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);

  const result = addItemToOrder(order, { itemId, size, quantity, options, addOns, notes });

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({
    reply: result.reply,
    sessionId: activeSessionId,
    order,
    needsClarification: Boolean(result.needsClarification),
    quickReplies: result.quickReplies || null,
  });
});

// Modifies quantity, size, and/or options on an existing order item.
// Does not support checkout yet.
app.patch("/api/order/items/:lineId", (req, res) => {
  const { sessionId, quantity, size, options, addOns, notes } = req.body || {};
  const { lineId } = req.params;

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);

  const result = updateOrderItemInOrder(order, lineId, { quantity, size, options, addOns, notes });

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

// Selects dine-in as the order type and collects the customer's name and
// phone number (both required), ahead of checkout.
app.post("/api/order/dine-in", (req, res) => {
  const { sessionId, name, phone } = req.body || {};

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);

  const result = setDineInDetails(order, { name, phone });

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ reply: result.reply, sessionId: activeSessionId, order });
});

// Sets (or clears, with an empty string) the order-level special instructions note.
app.post("/api/order/notes", (req, res) => {
  const { sessionId, notes } = req.body || {};

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const order = getOrCreateOrder(activeSessionId);

  const result = setOrderNotes(order, notes);

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

// Returns this session's own placed orders (newest first) for the customer-
// facing Orders tab. Read-only, scoped by sessionId — no customer accounts,
// consistent with the rest of the customer flow. Reuses the same saved-order
// log the staff dashboard reads, just filtered to one session.
app.get("/api/order/history", (req, res) => {
  const { sessionId } = req.query;

  const resolved = resolveSessionId(sessionId);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }

  const activeSessionId = resolved.sessionId;
  const orders = readSavedOrders()
    .filter((record) => record.sessionId === activeSessionId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ sessionId: activeSessionId, orders });
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

  res.json({
    reply: result.reply,
    sessionId: activeSessionId,
    order,
    orderId: result.orderId || null,
    orderTotal: result.orderTotal != null ? result.orderTotal : null,
  });
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
