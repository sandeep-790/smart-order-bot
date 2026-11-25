# CHANGELOG (recovered history)

Sources: `git log` (all branches, 40 commits), `gh pr list` (29 PRs, all merged), and the recovered Claude transcript. Commit/PR titles are the author's own (often terse). Commit→PR pairing for #22–#29 is **Inferred** from titles/dates.
This is **recovered history**; the documentation exercise itself is logged at the bottom and is *not* project history.
Bullet details beyond the commit/PR **titles** (e.g. what exactly shipped in PR #4, #12–#18) are **Inferred** by matching the owner's request timestamps to commit dates; use `git show <hash>` for ground truth.

## 2026-08-16 — Foundation (transcript starts 08:23 UTC)
- `7642504` Initial commit: ordering backend, chat UI, staff dashboard. Built step-by-step from the owner's prompts: scaffold → CLAUDE.md → system prompt → menu/promotions/orders data → chat UI (mock) → `/api/chat` → order state, add/modify/remove, summary, recommendations, promotions, pickup/delivery/address confirmation, deterministic totals, review, confirmation gate, persistence → staff dashboard → audit vs. prompt → deployment prep.
- `476fd76` (PR #1) Wire customer chat UI to backend; **staff Basic Auth**; deployment prep.
- `b3d6855` (PR #2) **Serve frontend from the backend** (single origin); `API_BASE` relative; Render "Cannot GET /" resolved.
- `b5006cd` (PR #3) Real AI provider (Gemini via OpenAI-compatible API), **South Indian menu (60+ items, ₹)**, voice input, rebrand to South Indian Cafe, "SmartOrder" tab.
- `386ec35` (PR #4) Flow/UI completion: ground rules (no hallucination), 10 welcome questions, **RoboCap** naming, item cards with thumbnails, dine-in, notes, Orders tab, floating cart, categories jump, auto-send mic with loader, blue theme.

## 2026-08-17
- PR #5 `8fdcf89` inline items UI + AI voice. PR #6 `061237c` **Sarvam AI TTS** + UI. PR #7 `0b07685` AI model name. PR #8 `363da26` responsive TTS. PR #9 `83c8d56` session changes. PR #10 `836a76e` chat window, non-welcome quick replies. PR #11 `4adc1cb` mic focus bug. 
- (transcript) streaming TTS, TTS text normalization, no auto-keyboard, mic repeat fixes, quantity ground rule, order-confirmed lock, mute per message, 70-item real food images generated/fetched.

## 2026-08-18
- PR #12 `a97b50e` Android mic repeat fix; order-confirmed TTS scoped; post-confirmation lockdown. PR #13 `5f69ac7` images/chat window/chips. PR #14 `2353b48` **pairing logic**. PR #15 `199deb6` chat window & main page UI (two tabs, draggable RoboCap floater with edge snapping). PR #16 `f01ee77` UI chat changes. PR #17 `2c88e17` lazy-load & UI elements (typing loader, skeletons). PR #18 `a265520` view-cart logic.
- (transcript) Reskin from `RoboCap Standalone.html`; compare cards with "Best for"/recommendation; friendly AI-failure fallback; footer "RoboCap is always learning. Powered by Petpooja".

## 2026-08-19
- PR #19 `c083ec7` chat session issue. PR #20 `4f0cf98` & PR #21 `8c7ec49` disclaimer changes.
- PR #22 `e69c16f`, `b090d33` **Native Gemini `generateContent` chat + Sarvam voice** (branch `feature/gemini-native-live-api`; Gemini TTS tried then rolled back; `LIVE_MODEL` fixed to `gemini-flash-lite-latest`).
- PR #23 `8cd9df7` sarvam-speech-speed. Perf pass: `SKELETON_MIN_MS` 1500→300, memoized system content.

## 2026-09-03/04 — Figma dark redesign & polish
- 2026-09-03 PR #24 `8dd00a7`, `78b1d97` **Dark-theme chat redesign (Figma port) + performance and TTS fixes**; removed stray `backend/backend`. Splash screen, item customization bottom sheet, order summary card, comparison "VS" layout, new Petpooja logo.
- 2026-09-04 PR #25 `6183dc3` order-review card, reply-chip styling, aurora background (+`48e6d86`). PR #26 `d38c987` welcome chip copy ("Recommends", "Today's special"), denser dots, message spacing. PR #27 `ca8e5a0` robocap-changes: **Menu-top RoboCap banner replaces floater**. PR #28 `5800012` paperfold-issue.
- PR #24 had initially been left unmerged → production didn't update; merged 2026-09-04.

## 2026-09-08
- PR #29 `d439179` **Gradient CTA buttons (`--accent-gradient`), colored-dot ambient background, outlined sparkle icon, close-button fix, Android safe-area padding, footer logo size.** Merged to `main` (merge `043a2ca`).

## Uncommitted at documentation time (not yet history)
- 2026-09-08: borderless, full-width bot bubble; explicit Figtree on bot bubbles (`frontend/style.css`).
- 2026-09-11: default port 3000 → 4000 (`.env.example`, `README.md`, `backend/server.js`, comments in `frontend/app.js`/`staff.js`; local `.env`).

## Since the memory folder was written (2026-11-24; all UNCOMMITTED)
- Brand colour changed orange/blue → plum `#412234` (light screens, Cart/Checkout/Orders/Staff) with a lightened rose tint `#c0598a` (+`#e59cc0`) inside the dark chat window; "Powered by" logo replaced with a **Sandy** wordmark (`frontend/assets/sandy-logo*.svg`, placeholder drawn by Claude — swap in the real logo).
- Menu cards redesigned Zomato-style (photo right, ADD overlapping it); ADD opens the customization bottom sheet for customisable items and turns into a `− n +` stepper reflecting cart quantity. The sheet (`#itemSheetBackdrop`) moved to the app root so Menu and chat share it.
- New café header logo, new Menu/Orders tab icons; RoboCap banner redesigned (aurora border, live orb, typing "ask" bar, feature tags; quick-question chips removed).
- Chat landing splash rebuilt as an AI boot sequence (core + rings, status checklist, greeting, glowing CTA).
- Chat "thinking stage": on send, the user's message scrolls to the top and a full-height loader (words absorbed into a glowing core, context-aware status lines, soundwave, ghost answer, burst on reply) shows for >=1.2 s (`MIN_TYPING_MS`).
- Chat background (2026-11-25): added `.chat-bg` (`index.html` first child of `#view-chat`, CSS after `chat-mesh-breathe` in `style.css`) — three drifting light orbs and a periodic scan beam clipped through the 5px dot-grid mask, plus 8 rising motes; transform/opacity only; reduced-motion shows static orbs.
- Chat dock (2026-11-25): composer + "Powered by" now live in `.chat-dock` (absolute, no background, blurred gradient `::before` with backdrop-filter); `.chat-area` extends to the bottom with 112px bottom padding (172px with the floating cart). Background light effects dimmed ~30%.
- Typeface (2026-11-25): app-wide font changed from Figtree (chat only) / system font to **Bricolage Grotesque** via `--font` in `style.css` (+ `staff.css`, Google Fonts link in `index.html` and `staff.html`, form controls inherit). Chat item Add now plays a compact thinking stage before the bot follow-up. Order-placed card no longer sits under the dock blur; welcome chips thinner; light screens use `--chat-bg:#f5f0f3` (no cream).
- Bot skeleton (2026-11-25): `botSkeleton(text, ms)` in `app.js` + `.bot-skeleton` CSS — shimmering lines (count follows text length) shown ~650 ms before every bot message (reply, add-to-cart follow-up, error, start-over) and 1.1 s for the welcome (replaced the dotted bubble).
- Composer (2026-11-25): bottom dock is now ONE pill — cart (left) · text field · single action button (right). `data-mode` on `.chat-input-wrap` (`updateComposerMode` in `app.js`): mic when empty → stop square while listening (glow, waveform, shimmering "Listening…", live transcript) → up-arrow send once there is text. **Voice no longer auto-sends after 2 s of silence**: Stop leaves the transcript in the box and the customer presses Send. Splash now stacks above the dock.
- Header + tabs redesign (2026-11-25, `style.css` only): header is a layered card (plum corner glow, dot texture, rounded bottom, lifted shadow, ringed logo tile, bold title, pulsing-dot tagline, glass "Powered by Sandy" pill); tab bar is a floating segmented control whose white thumb slides between Menu/Orders (`.tab-bar:has(.tab-button[data-tab=orders].active)`).
- Cart redesign (2026-11-25; `index.html`, `renderCart`/`loadRecommendations`/`loadPromotions` in `app.js`, `style.css`): icon back button + title/subtitle header (shared with Checkout), item cards (photo looked up from `state.menu` by name, variant pills, trash icon, kitchen-note field, gradient stepper), receipt-style "Bill details", ticket-style promo cards, swipeable "You might also like" mini cards, raised checkout dock. Section titles (`.panel-section-label`) restyled app-wide.
- Item-row scroll cue (2026-11-25): removed the round chevron (looked like a button) from chat item-card rows; `attachScrollHint` in `app.js` now gives a right-edge fade, a non-interactive scroll-progress bar under the row, and a one-time sideways nudge when the row first scrolls into view. Tab icons replaced with an open-menu-book and a receipt-with-tick.
- In-chat cards redesign (2026-11-25; `index.html` order-locked banner, `renderCartSummaryBlock`/`appendDetailsForm` markup in `app.js`, `style.css`): shared glass-card surface (`.chat-cart-summary`, `.chat-details-form`); Your order = icon tile + fulfilment pill, tile per line with gradient stepper/variant pills/Change pill, Add more / Place order with icons (+ `flex-shrink:0` so cards never shrink in the flex transcript); Your details = icon fields with focus glow + lock chip; Order placed = chip, popping check with drawn tick + ripples, ticket-style stats strip, Track it / Start a new order buttons.
- Yes/No decision dock (2026-11-25): `REPLY_CHIP_RULES` now maps yes → `confirm`, no → `decline`; `appendReplyOptions` renders a yes/no pair as `.chat-reply-options--decision` (glass bar, filled gradient yes with a tick, outlined no with an edit/× icon). Half/Full size pills and the retry chip keep the outlined `--primary` style.

## Documentation exercise (2026-10-16) — not project history
- Created `PROJECT_MEMORY/` (00–14 + this file) and updated root `CLAUDE.md`. No application code changed.
