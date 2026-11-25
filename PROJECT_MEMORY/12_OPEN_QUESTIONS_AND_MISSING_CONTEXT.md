# 12 — Open Questions & Missing Context

## A. Context that existed only in inaccessible places
| Missing | Why it matters | Where to look / what's needed |
|---|---|---|
| **Screenshots/attachments** the user sent (Figma frames, reference images, `RoboCap Standalone.html`, `IMG_4904.HEIC`, Petpooja SVG) | They define exact visual targets; transcripts only describe them | Ask the owner for the Figma file (`WpvQjNNUFcoVUHmmQ5jOh1`, node `693-4011`) and references; the final CSS is the best proxy |
| **Full text of assistant reasoning** for most UI iterations | Only user requests + selected assistant summaries were recovered | `git log -p` per commit for what changed; this folder for outcomes |
| Several user requests are truncated in this folder's summaries (long bullet lists) | Fine-grained acceptance criteria | The original Claude Code transcript (`~/.claude/projects/-Users-sandeep-Documents-Claude-Projects-cafebot/3af4f7fc-…jsonl`) — **only on the original account/machine** |
| Hosting/dashboard state (Render env, auto-deploy, disk, plan) | Can't tell what production runs | Owner / Render dashboard |
| Contents of `.env` values & whether keys are still valid | Needed to run AI/voice | Owner (never commit) |
| The `fetch-menu-images.js` approach used to source menu photos (2026-08-17) | Image provenance/licensing unknown | Unknown — ask owner; images are real JPGs in `frontend/assets/menu/` |
| Contents of the Claude "memory" directory | Was empty at doc time | n/a |

## B. Questions for the project owner
1. **Is production live, on which URL, and does it auto-deploy `main`?** (Render service `smart-order-bot` in history.) Affects whether PR #29 and later work is public.
2. **Have the API keys been rotated** after being exposed in AI-session output? (Keys must not live in docs.)
3. **Was the Render staff password changed** from the local placeholder?
4. **Commit the uncommitted changes?** (borderless full-width bot bubble, Figtree, port 4000). Is port **4000** acceptable, or a different port intended?
5. Should **Orders tab** also have a RoboCap entry (the old floater was on both tabs; the new banner is Menu-only)?
6. What should RoboCap answer about **hours, location, payment methods** (system prompt scope mentions them; no data exists)?
7. **Timezone** the cafe operates in (promotion windows currently use the server's local time).
8. Is there a plan for a **database/persistent disk** and customer data retention for `orders.json`?
9. Is the **"ask before running the local server"** instruction (2026-09-03) still in force?
10. Do you want tests/CI added (none exist)?
11. Should the 52 tracked `.claude-flow/*` files be removed from git?
12. Are the **menu images** licensed for production use?
13. **Sarvam 502s — cause found (2026-11-25):** not intermittent. Sarvam answers **403 `invalid_api_key_error`** to every request, so the `SARVAM_API_KEY` in `.env` is invalid/expired/revoked (key length 35; speaker `Ritu`, model `bulbul:v3` are fine). `/api/tts` converts any upstream failure into a generic 502. **Fix = issue a new key in the Sarvam dashboard, put it in `.env` (and Render's env vars), restart, then verify with the curl in `promo-video/` notes / the chat's voice.** Owner action required; the same key was exposed in earlier transcripts, so rotation was already recommended.

## C. Unverified implementation assumptions in this folder
- Android send-button fix works on a physical device.
- Exact in-chat order-summary card contents (tax/total omission) — verify `renderCartSummaryBlock`.
- Duplicate-summary fix (Sept 4) behavior in all paths.
- That Render's current deployment matches `main`.
- That `GET /api/menu/recommendations` is still consumed by the UI (frontend calls `loadRecommendations`).
- Gemini free-tier quotas.

## D. How to resolve
Prefer reading code and running the app (checklist in `07_…`); then ask the owner for items in B; then update this file.
