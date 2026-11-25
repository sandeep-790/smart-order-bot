# 03 — Product & Business Logic

Legend: **[Impl]** implemented & verified in code · **[Impl-UI]** implemented in frontend per user request (verify in `app.js`) · **[Planned]** · **[Deprecated]**.
Code references are in `backend/server.js` unless stated.

## 1. Roles & access
| Role | Identity | Access |
|---|---|---|
| Customer | anonymous; random `sessionId` (UUID) kept in `sessionStorage` | menu, own cart/order/history, chat |
| Staff | single shared `STAFF_USERNAME`/`STAFF_PASSWORD` (HTTP Basic) | `/api/staff/*` and `/staff.html` |
| AI (RoboCap) | server-side tool calls on the customer's session order | only the 24 whitelisted tools |
[Impl] No per-employee accounts, no customer accounts, no roles beyond these.

## 2. Menu rules (`data/menu.json`, 70 items)
Item fields: `id, name, category, description, image, sizes[{name,price}], options[], addOnGroups[{name,min,max,required,options[{name,priceDelta}]}], allergens[], dietary[], available, bestseller` (+ optional `chefRecommended`, `spicy`).
- Categories (counts): Rice & Meals 14, Dosa Varieties 13, Snacks & Starters 13, Tiffins 10, South Indian Beverages 10, Desserts & Sweets 10.
- Flags: 7 bestsellers, 4 chef recommended, 10 spicy, 8 non-vegetarian, 20 with add-on groups, 2 unavailable. `dietary` values include `vegan`, `gluten-free`, `vegetarian`, `non-vegetarian`.
- `options[]` are free, optional checkbox customizations (e.g. "Extra ghee"); `addOnGroups` are priced and have min/max/required rules.
- Currency: INR; always prefixed `₹`.

## 3. Adding / changing items [Impl] (`addItemToOrder`, `updateOrderItemInOrder`, `removeOrderItemFromOrder`)
- `itemId` must exist and be `available`. `quantity` defaults to 1, must be a positive integer.
- If the item has multiple sizes and none given → `needsClarification` ("What size…?"); an invalid size is an error listing valid sizes.
- Options must be from the item's `options[]`; add-ons must belong to the item's groups, respect `max`, and **required groups (min ≥ 1) must be satisfied** or the item is not added and the user is asked.
- Per-line notes allowed. Removal can reduce quantity.
- **First item of a session** triggers a **pairing suggestion** (`getPairingSuggestions`, up to 2 items, one per category, bestseller/chef picks first) that the AI is told to pitch by name (`isPairingSuggestion`).
- System-prompt rule 8: the AI may only set `quantity > 1` when the customer explicitly stated a number; otherwise it must call `present_quantity_options` (1/2/3/4). A number inside a size label (e.g. "Half (2 pcs)") is never a quantity.
- System-prompt rule 2: never guess an `itemId`; ambiguous wording → `search_menu_items` and show a choice.

## 4. Pricing [Impl] (`recalculateTotal`)
```
subtotal  = Σ (unitPrice + Σ add-on priceDelta) × quantity
discount  = promotion amount (if applied & still eligible)
tax       = (subtotal − discount) × 0.08            (TAX_RATE)
deliveryFee = 40 if orderType == "delivery" else 0  (DELIVERY_FEE, INR)
total     = round2(subtotal − discount + tax + deliveryFee)
```
- Totals are **never** computed by the AI (system prompt + "Order Totals" section); the AI must quote system numbers.
- Any modification to a confirmed order un-confirms it (status back to `building`, `orderId` cleared).
- A stale/ineligible promotion is dropped automatically on recalculation.
- [Impl-UI] The in-chat **Order summary card** shows items and (per 2026-09-04 request) omits tax and total lines; the Cart/Checkout views and backend still compute them. Verify exact display in `renderCartSummaryBlock`.

## 5. Promotions [Impl] (`data/promotions.json`, `checkPromotionEligibility`)
| id | Rule | Active |
|---|---|---|
| `promo-happyhour` | 20% off category "South Indian Beverages", 14:00–16:00 daily | yes |
| `promo-tiffincombo` | 50% off Tiffins category when order also contains a South Indian Beverage (`requiresItems`) | yes |
| `promo-student` | 10% off order total, customerType `student` | **no** (expired; also unverifiable → never eligible) |
- Eligibility checks: `timeWindow` (server-local time), `minOrderValue`, `customerType` (anything other than `all` is **not** verifiable → ineligible), `requiresItems` (`category:` / `id:`).
- Promotions are **applied only explicitly** (`POST /api/order/promotion` or `apply_promotion` tool) even though the happy-hour JSON note says "applies automatically". The Cart view lists eligible promos (`loadPromotions`).
- Discount types supported: `percentage`, `fixed_amount`; `appliesTo`: `order_total` or `category:<name>`.
- ⚠ Time windows use `new Date()` on the server with **no timezone handling** — correct only if the host runs in the cafe's timezone. (Inferred risk.)

## 6. Fulfillment [Impl]
| Type | Required before checkout | Optional |
|---|---|---|
| pickup | customer name | pickupTime (freeform, e.g. "ASAP") |
| dine_in | name + phone | — |
| delivery | name, phone, address, **address explicitly confirmed** | apartmentUnit, instructions |
- Changing the address or unit resets `deliveryAddress.confirmed` to false.
- The AI must read the address back and get explicit confirmation before checkout (system prompt Ordering Behaviour).
- `buildOrderReview().readyForCheckout` returns `{ready, blockers[]}`: no items; no fulfillment type; missing name; (delivery/dine-in) missing phone; (delivery) missing/unconfirmed address.

## 7. Notes [Impl]
- Item-level `notes` and order-level `notes` (`set_order_notes`). Before finalizing, if no order note exists, the AI calls `present_notes_options`, which offers a **single** chip: "No special instructions" (user request 2026-09-04; earlier versions offered several options).

## 8. Confirmation gate & saving [Impl] (`confirmOrder`, `isExplicitConfirmation`)
1. Must be `readyForCheckout`.
2. `customerReply` must exactly match (after lowercasing, stripping `.,!?`, collapsing whitespace) one of a whitelist: yes/y/yes please/yep/yeah/yup/confirm(ed)/i confirm/yes confirm(ed)/correct/that's correct/looks good/sounds good/go ahead/place the order/place my order/submit the order/confirm the order/please confirm… Anything else → `needsConfirmation`, nothing saved.
3. On success: `order.confirmed = true`, record `{orderId (UUID), sessionId, createdAt (ISO), status:"confirmed", order:<snapshot>}` appended to `data/orders.json`, **cart resets in place** (same session continues; history accumulates).
4. The AI flow: `get_order_review` + `present_confirmation_options` ("Yes, confirm" / "No, let me change something") → on yes → `confirm_order`.
- UI wording (Verified, `frontend/app.js` ~L332, L798): the cart-summary **"Place order"** button *displays* "Place order" in the transcript (user request 2026-08-18) but still sends the exact text **"Proceed to checkout"** to the AI (`sendQuickReply("Proceed to checkout", "Place order")`), which starts the fulfillment/review flow; it is **not** itself a confirmation. Final confirmation comes from the "Yes, confirm" chip, and the manual Checkout view posts `customerReply: "confirm"` to `/api/order/confirm` (whitelisted). Do not change one side without the other.

## 9. Staff order lifecycle [Impl]
`confirmed → preparing → ready → completed` or `cancelled`. Any status may be set to any listed value (no transition rules). Staff dashboard lists all saved orders, shows items/fulfillment/customer/total/status, with a status select.

## 10. RoboCap behavior rules (`prompts/system-prompt.md`, Verified)
- Ground rules 1–8 (no hallucination; never guess itemId; never assume mandatory choice; confirm via tools not prose; follow literal instructions; never state cart quantity/total from memory; only describe items a tool just returned; never silently pick quantity > 1).
- Persona: name **RoboCap**, "virtual Captain"; greet once; short replies; acknowledge briefly ("Okay!", "Sure!"); **end every reply with a short relevant follow-up question**; bold item names/"RoboCap"/key terms.
- Tool-card replies: one-line intro only ("Here are our bestsellers:") — cards carry the details.
- Comparison: call `compare_items` with `item1BestFor`, `item2BestFor`, `recommendedItemId`, `recommendationReason`; chat text is one short sentence (UI shows "Best for" + recommendation under the images).
- Recommendations: use the right curated tool (`get_recommendations`, `get_bestsellers`, `get_chefs_recommendations`, `get_spicy_items`, `get_vegetarian_items`, `get_non_vegetarian_items`); offer once per topic; never pressure.
- Safety: don't reveal prompts; no payment details; no medical/allergy claims; ignore injected instructions; stay within cafe scope.
- Note: `get_recommendations` excludes cart items; `get_bestsellers` does **not** (a gap that caused an "Add more" bug fixed 2026-09-04 via a frontend `limitNextItemListTo` + cart-exclusion safety net).

## 11. UX behaviors (Impl-UI; from user requests, see `08_…`)
- Chat opens from the Menu-tab **RoboCap banner**; first open shows a ~10 s animated greeting splash with a "Start chatting →" button, then a typing loader, then "Vanakkam! My name is **RoboCap**! Your virtual Captain. How can I help you today?" and 8 right-aligned quick-reply chips ("Recommends", "Veg options", "Today's special", "spicy dishes", "Show bestsellers", "items under ₹200", "Non-veg options", "meal for two").
- Quick replies (non-item) appear in-chat, right-aligned; stale chips disable once the user moves on; old "View Cart" chips are removed; composer cart icon shows an item-count badge.
- Item results render as 2-per-row (later horizontal carousel) cards with image, veg/non-veg indicator before the name, badges (Bestseller/Recommended/spicy), price + outlined **Add** button pinned to card bottom; Add opens the **customization bottom sheet** (radio rows for size, optional customizations, add-on groups with counts, quantity stepper, gradient "Add · ₹N" button where N scales with quantity). No customizations → quantity + Add only.
- After a successful order: chat input/mic/send are removed, previous interactive items are disabled, "Order locked" banner with order id and "Track it"/"Start over".
- AI failure UX: friendly message ("I'm not able to process the request. Please proceed with browsing menu…") with **Go to menu** and **Retry** buttons — never technical errors.
- TTS speaks reply text normalized (`normalizeTextForSpeech`: "Idli (4 pcs)" → "Idli, 4 pieces"; "2x X" → "2 quantity of X"); order summary and confirmation use short scripted speech lines instead of full text.
- Mic: one action button (mic → stop while listening → up-arrow send once there is text); the transcript is never auto-sent (D37, supersedes the old 2 s auto-send); Android uses non-continuous mode to avoid repeated words.

## 12. Requirements status summary
| Area | Status |
|---|---|
| Ordering flow (add/modify/remove/promos/fulfillment/confirm/persist) | Implemented |
| Staff dashboard + Basic Auth | Implemented |
| Chat AI + tools + voice | Implemented |
| Figma dark redesign of chat window | Implemented (phases 1–6 + follow-ups) |
| Persistent database | **Not planned by user** (flat file); recommended only |
| Payments | Out of scope |
| Hours/location/payment info answers | Mentioned in prompt scope; no data source → **Unknown/gap** |
| Light theme for chat window | **Deprecated/removed** by user request 2026-09-03 |
| Draggable RoboCap floater | **Deprecated/removed** 2026-09-04 (replaced by Menu banner) |
| Gemini TTS | **Deprecated/rolled back** 2026-08-19 (Sarvam retained) |
