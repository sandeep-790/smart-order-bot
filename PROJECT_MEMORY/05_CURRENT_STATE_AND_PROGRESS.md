# 05 — Current State & Progress (as of 2026-10-16)

## Snapshot
- Branch: `feature/gemini-native-live-api` (local HEAD `d439179`, 2026-09-08). `origin/main` contains GitHub merge commits through **PR #29** (`043a2ca`); local branch is simply behind those merge commits. All 29 PRs on `sandeep-790/smart-order-bot` are merged; none open (checked via `gh pr list`).
- **Uncommitted working-tree changes (Verified via `git status`)** — the last user-requested work, never committed/PR'd:
  - `frontend/style.css`: bot bubble border removed + `.bubble-wrap` stretched to 100% for bot rows + explicit Figtree `font-family` on bot bubbles.
  - Port 3000→4000: `.env` (local, untracked), `.env.example`, `backend/server.js`, `README.md`, comments in `frontend/app.js`, `frontend/staff.js`.
  - `.claude-flow/*` modifications/untracked session files and `frontend/.claude-flow/` — tooling noise, not product work (do not commit).
- No tests, no CI, no lint. Last manual verification: 2026-09-11 (server on :4000 returned 200 for `/api/menu`; Menu page rendered; no console errors besides pre-existing Sarvam 502s).

## Update 2026-11-24 (after this folder was first written)
Large UI changes are in the working tree, **uncommitted** (see `CHANGELOG.md` → "Since the memory folder was written" and decisions D31–D35 in `04_…`): plum palette, Sandy logo, Zomato-style Menu cards with bottom-sheet ADD + stepper, new header logo/tab icons, redesigned banner, AI-boot landing splash, and the thinking stage. Counts/line numbers elsewhere in these docs predate this. Known observation: the welcome chip "items under ₹200" returned an AI "couldn't find items by that exact…" reply in one test (AI behaviour, not investigated).

## Completed & verified (manual browser/curl checks during development)
- Full ordering backend: add/modify/remove, promotions, pickup/delivery/dine-in, address confirmation, deterministic totals, confirmation gate, persistence, per-session history, staff Basic Auth + status updates.
- Frontend: Menu (categories + jump popup), Cart, Checkout, Orders, RoboCap chat overlay with splash, typing loader, skeleton cards, item cards, customization sheet, comparison cards, order summary card, post-order lock, AI-failure fallback with retry.
- AI: native Gemini tool-calling loop (24 tools), pairing suggestion, quantity-clarification rule.
- Voice: Sarvam streaming TTS (+ mute per message), STT with 2 s auto-send, Android repeat-word fix.
- Figma dark-theme port (phases 1–6) + many follow-up polish rounds; Menu-top RoboCap banner (2026-09-04); gradient CTA buttons (orange in chat, blue elsewhere); outlined sparkle icon; Figtree font; dots-only colored ambient background.
- Bug fixes worth knowing: `closeChatWindow` received the click Event as `destinationTab` (blank page after closing chat) — fixed 2026-09-04 by wrapping handlers in `() => closeChatWindow()`.

## Implemented but **not** verified
- Android send-button clipping fix (`viewport-fit=cover` + safe-area padding + Petpooja logo 7px): checked only in a 360px desktop emulation; **no confirmation from the user's Android phone**.
- Whether PR #29 / the latest `main` is live in production (hosting state Unknown).
- Bubble full-width/borderless result with long messages, quick-reply-heavy flows, and the comparison/cart cards in full-width bubbles was only spot-checked with 2 short messages.
- Real Gemini/Sarvam behavior depends on valid keys in the current environment (not re-tested since 2026-09-11).

## Partially complete / known gaps
- README is stale (says four tabs/Chat tab; missing banner, Figma redesign, TTS details of the final state).
- RoboCap entry exists only on the **Menu** tab (banner); the Orders tab has no entry (old floater was on both).
- System prompt scope mentions cafe hours/location/payment info but no such data exists.
- `GET /api/menu/recommendations` doc text vs code (5 items) mismatch in older docs.

## In progress
- Nothing in flight. The last request was this documentation task (PROJECT_MEMORY).

## Known bugs / risks (reproducible or evidenced)
| Item | Evidence |
|---|---|
| Promotions use server-local time (no TZ) | `checkPromotionEligibility` uses `new Date()` |
| Orders/carts lost on restart; `data/orders.json` wiped on ephemeral hosts | in-memory Map; README warning |
| Sarvam TTS returns **502** intermittently in dev (frontend stays silent by design) | console logs seen throughout 2026-09 sessions (cause Unknown — upstream/key/quota?) |
| `.env` contains unused stale keys (`AI_API_*`, `LIVE_VOICE`) and a weak local staff password | `.env` key names (values not recorded here) |
| `backend/.env` is an empty stray file | `wc -c` = 0 |
| 52 `.claude-flow/*` tooling files are tracked in git | `git ls-files` |
| Real API keys appeared in an AI-session transcript (this tool displayed `.env`) | see `14_…` security note — rotate keys |

## Blockers & dependencies
- None technical. Needs owner decisions: rotate keys; confirm production host/env; whether to commit the uncommitted changes.

## Recent meaningful changes (newest first, from git + transcript)
- 2026-09-11 (uncommitted): port → 4000.
- 2026-09-08 (uncommitted): borderless full-width bot bubble; Figtree.
- 2026-09-08 `d439179` / PR #29: gradient CTA buttons, colored-dot ambient background, outlined sparkle, close-button fix, safe-area padding, footer logo size.
- 2026-09-04 PRs #24–#28: dark Figma redesign, customization sheet, order-summary card, Menu banner, many polish items.
- 2026-08-19 PRs #20–#23: native Gemini API, Sarvam TTS, perf fix.
Full list: `CHANGELOG.md`.

## Last known working state
Local server on port 4000 with the uncommitted changes: Menu + banner, chat open/close, chat message send (Gemini reply received during testing), item customization sheet with gradient Add button. (2026-09-11)

## Next recommended actions (priority order)
1. Decide on and commit/PR the uncommitted changes (`style.css`, port change) — owner approval required; keep `.claude-flow/*` out.
2. **Rotate** Google/Sarvam API keys and the staff password (keys were exposed in transcripts); remove stale vars from `.env`; delete empty `backend/.env`.
3. Confirm production (Render) env vars: `GOOGLE_API_KEY`, `LIVE_MODEL`, `SARVAM_*`, `STAFF_*`, `PORT` untouched; set timezone strategy for promos.
4. Verify the Android send-button fix on a real device.
5. Update README (tabs, banner, port, features).
6. Consider a persistent store for orders and a minimal test script (curl or Node test) for the order/confirmation rules — recommendations, not requirements.
