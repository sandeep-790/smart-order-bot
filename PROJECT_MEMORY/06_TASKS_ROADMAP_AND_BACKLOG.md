# 06 — Tasks, Roadmap & Backlog

**Section A = requirements/instructions explicitly stated by the owner (recovered).** **Section B = recommendations produced by this audit (not requested).**
Do not treat B as approved work.

## A. Owner-confirmed items

| ID | Item | Status | Priority | Files | Notes / acceptance |
|---|---|---|---|---|---|
| A1 | Commit & PR the uncommitted work (borderless full-width bot bubble, Figtree, port 4000) | Pending (owner has not asked to commit) | Next | `frontend/style.css`, `.env.example`, `README.md`, `backend/server.js`, `frontend/app.js`, `frontend/staff.js` | Only on explicit request; stage app files only, exclude `.claude-flow/*`; PR to `main` via `gh`; do not add secrets |
| A2 | Verify Android send-button fix on a real phone | Open (user-reported 2026-09-04; fix applied, unconfirmed) | Medium | `frontend/index.html` (viewport meta), `frontend/style.css` `.chat-input-bar` | Acceptance: send button fully round and uncropped on the user's Android device |
| A3 | Production sync | Unknown | Medium | Render dashboard | User asked on 2026-09-04 why production didn't update — cause was PR #24 unmerged; since then everything merged. Confirm auto-deploy |
| A4 | Replace placeholder staff password on Render | Unknown | High | Render env | User was given steps 2026-08-16; completion not recorded |

Delivered owner requests (all done — history only): see `CHANGELOG.md` and `08_…` for the full requirement list.

## B. Audit recommendations (NOT confirmed requirements)

### Security / secrets
- B1 **Rotate** `GOOGLE_API_KEY`, `SARVAM_API_KEY`, and the staff password; they were displayed in AI-session output. Remove unused `AI_API_*`, `LIVE_VOICE` from `.env`. Delete empty `backend/.env`.
- B2 Move the Gemini key out of the URL query string into the `x-goog-api-key` header (`callAiApi`).
- B3 Add basic rate limiting on `/api/chat` and `/api/tts` (public endpoints that spend API credits).
- B4 Tighten CORS (same-origin now) — README already advises this.

### Data & reliability
- B5 Persist orders in a real DB or Render persistent disk; persist carts or accept loss on restart.
- B6 Handle timezone for promotion windows (`Asia/Kolkata`) explicitly.
- B7 Transition rules for staff statuses (currently any → any).
- B8 Supply cafe hours/location/payment info as data for the AI (prompt scope mentions them; none exist).

### Quality
- B9 Add an automated check for pricing, confirmation whitelist, add-on validation (Node test runner or script); dependencies: none (use built-in `node:test`).
- B10 Split `server.js`, `app.js`, `style.css` into modules (project rule: small files). Sequence after B9 so refactors are protected.
- B11 Refresh `README.md` (tabs, banner, port, Figma redesign) and fix stale comments.
- B12 Remove 52 tracked `.claude-flow/*` files from git and add to `.gitignore` (needs owner OK).
- B13 Investigate intermittent Sarvam 502s (key validity/quota/payload).
- B14 Add RoboCap entry on the Orders tab if desired (previous floater appeared on both tabs) — confirm with owner first.

### Performance (from recovered diagnosis)
- B15 Remaining latency is structural (~0.85–1.0 s per Gemini call × tool round-trips). Options: fewer tool round-trips via prompt/tool design (trade-off vs correctness), or faster model. Context caching and thinkingBudget were tested and rejected.

## Sequencing constraints
B9 → B10; B1 before any deployment/sharing of the repo; A1 before B11/B12 to avoid mixing noise into the PR.
