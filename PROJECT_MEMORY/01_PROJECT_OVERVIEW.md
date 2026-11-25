# 01 — Project Overview

## Vision & objectives
Original brief (Recovered, 2026-08-16): "a simple chatbot for a cafe" — beginner-friendly, minimal, low-cost, no heavy
infrastructure, no database (`CLAUDE.md`). It grew, over ~2 months of iteration, into a full ordering product:
a South-Indian-cafe ordering app where an **AI assistant (RoboCap)** can take a complete order by conversation, with the same
guarantees (validation, deterministic pricing, explicit confirmation) as the manual Menu→Cart→Checkout flow.

Stated product goals (Recovered from user requests):
- AI **must not hallucinate**: menu items, prices, sizes, add-ons, promotions must come only from data files. First "ground rule" (2026-08-16).
- AI should **confirm before deciding** and offer **tappable options** instead of making users type.
- The chat should feel like an **intelligent assistant, not a human chat** (2026-08-18) — hence structured cards, accent-colored highlights, outlined icons.
- Fast, modern, mobile-first UI; later ported to a **Figma dark design** (2026-09-03).
- Natural, **Indian-English voice** replies, with mute.

## Business & technical background
- Restaurant identity: "South Indian Cafe — Pure south authentic food"; currency INR (₹); menu is South Indian (tiffins, dosas, rice, snacks, beverages, desserts, non-veg).
- Branding partner: **Petpooja** (restaurant-tech company). Header branding was moved to a footer disclaimer: "RoboCap is always learning. Powered by [Petpooja logo]".
- Technical background: Node/Express + vanilla JS; deployed (at least once) to **Render** as a single web service.

## Target users and use cases
| User | Use cases |
|---|---|
| Customer (mobile web) | Browse menu by category; add items with size/options/add-ons; ask RoboCap for recommendations/bestsellers/veg/spicy/under-₹200/meal-for-two; compare two items; order by chat or by tapping; apply promotions; choose pickup/delivery/dine-in; add item/order notes; review and confirm; see own order history |
| Staff | Log in (HTTP Basic), view all confirmed orders, change status (confirmed → preparing → ready → completed / cancelled) |

## Major features (all Verified in code unless noted)
- 70-item menu (6 categories), item images (70 JPGs in `frontend/assets/menu/`), add-on groups with min/max/required rules (20 items), 7 bestsellers, 4 chef recommendations, 10 spicy, 8 non-veg, 2 unavailable.
- Cart/checkout with pickup, delivery (address confirmation gate), dine-in; item-level and order-level notes.
- Deterministic pricing: subtotal − promotion discount + 8% tax + ₹40 delivery fee (delivery only).
- Promotions engine with time windows, required items, minimum order, customer type.
- RoboCap: 24 AI tools, structured UI payloads (item cards, comparison "Best for"/recommendation, order summary card, quick replies), first-add **pairing suggestion**, typing indicators, skeleton loaders.
- Voice: speech-to-text (browser Web Speech API, `en-IN`, 2-second auto-send with loader on the Send button) and text-to-speech (Sarvam Bulbul, streamed MP3), per-message mute.
- Item customization bottom sheet; "Add more" on order summary requests 2 recommended items excluding cart items; "Change" opens the sheet in edit mode.
- Post-order lockdown of the chat (previous interactive elements disabled; "Start over").
- Staff dashboard with Basic Auth.
- Menu-tab **RoboCap banner** (entry point to chat; replaced the former draggable floater on 2026-09-04).

## Scope, exclusions, constraints
- **Single location**, single shared staff login, **no customer accounts** (identity = random `sessionId` in `sessionStorage`).
- **No database**, **no payments** (payment "handled outside the chat" — `prompts/system-prompt.md` Safety Rules).
- No automated tests, no CI/CD in repo.
- Constraints from `CLAUDE.md`: do only what's asked; small files; no new frameworks; never commit secrets; validate input at the API boundary.
- AI scope (system prompt): menu questions, ordering, confirmation/status, basic cafe info only; politely redirects everything else.

## Success criteria (Inferred — none are formally documented)
Customer can complete an order end-to-end by chat or UI; AI never states a wrong price/item; no order is saved without explicit confirmation; replies feel fast (target: TTS starts right after text appears).

## Known limitations (Verified/Inferred)
- Flat-file persistence; in-memory carts lost on restart; ephemeral on typical PaaS filesystems.
- Each Gemini call has a ~0.85–1.0 s floor and tool use adds round trips (1.2 s / 1.9 s / 2.9 s for 0/1/2 tool round-trips, measured 2026-08-19, Recovered).
- Single shared staff credential over Basic Auth (needs HTTPS).
- Promotion time windows use server-local time. No hours/location/payment data exists in `data/` even though the system prompt mentions "basic cafe info (hours, location, payment methods)" — **Unknown** where the AI would get these.
- README is partly stale (still says "four tabs" and "Chat tab").
