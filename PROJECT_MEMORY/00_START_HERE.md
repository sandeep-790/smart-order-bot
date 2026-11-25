# START HERE — CafeBot / RoboCap Project Memory

> Documentation date: **2026-10-16**. Latest commit on the working branch: `d439179` (2026-09-08).
> Evidence labels used throughout this folder: **Verified** (seen in code/files/git this session),
> **Recovered** (from the original Claude conversation transcript, which was accessible when this was written),
> **Inferred** (reasoned from code, not stated anywhere), **Unverified**, **Unknown**.

## 1. What this project is
**CafeBot** is a web app for a single-location restaurant, branded **"South Indian Cafe"** (tagline "Pure south authentic food").
Customers browse a 70-item South Indian menu, build an order, and check out (pickup / delivery / dine-in).
Staff track and update orders on a small password-protected dashboard.

Its centerpiece is **RoboCap** ("your Virtual Captain") — an AI chat assistant (Google Gemini, with tool-calling) that can do
everything the guided UI can do through conversation, and speaks its replies aloud (Sarvam AI text-to-speech).
RoboCap was originally called "Capi" and, before that, "CafeBot"; the user renamed it (recovered, 2026-08-16).

## 2. Who it is built for
- **Customers** of the cafe (mobile-first; Android and iOS browsers; Indian English voice).
- **Cafe staff** (one shared login, no per-employee accounts).
- Owner/developer: **Sandeep Kurapati** (sandeep.kurapati@petpooja.com, GitHub `sandeep-790`). The UI carries **Petpooja** ("Powered by Petpooja") branding.

## 3. Current status (as of 2026-10-16)
- Fully working locally: Menu, Cart, Checkout, Orders, RoboCap chat + voice, staff dashboard. (Verified live in browser during the last sessions.)
- A production deployment on **Render** (`smart-order-bot.onrender.com`) existed as of 2026-08/09 (Recovered). Its current state, env vars, and auto-deploy setting are **Unknown**.
- **Uncommitted local changes exist** (not yet in git): bot message bubble now borderless + full width, explicit Figtree font on bot bubbles, and the **default port changed 3000 → 4000** (`.env`, `.env.example`, `backend/server.js`, `README.md`, comments in `frontend/app.js`/`staff.js`). See `13_NEXT_SESSION_HANDOFF.md`.
- There are **no automated tests**, no CI, and no deploy config in the repo.

## 4. Most important facts (read before touching anything)
1. **One server, one origin.** `backend/server.js` (Express, single 2,221-line file) serves the REST API **and** the static frontend (`express.static`). `API_BASE` in the frontend is `""` (relative). Run: `cd backend && npm install && npm start` → <http://localhost:4000>.
2. **Vanilla stack.** Frontend is plain HTML/CSS/JS (no framework, no build step). No database: orders live in an in-memory `Map` per session, and confirmed orders append to `data/orders.json` (gitignored; contains customer PII once used).
3. **The AI never decides money or confirmation.** Prices/totals are computed deterministically in `recalculateTotal()`; checkout requires an explicit whitelist phrase via `isExplicitConfirmation()`. The model only calls tools that wrap existing validated functions. **Do not weaken this.**
4. **Chat window theme is intentionally separate** from the rest of the app: dark + orange (`#f36a20`), scoped under `#view-chat` in `frontend/style.css`. Menu/Cart/Orders stay light + blue (`#2f5fa8`). Never put chat-theme tokens on `:root`.
5. **Secrets:** `.env` (gitignored) holds real API keys. Never copy values into docs/commits. See `07_DEVELOPMENT_AND_OPERATIONS.md` and the security note in `14_MIGRATION_READINESS_REPORT.md` (keys should be rotated).
6. **Git workflow:** work on `feature/gemini-native-live-api`, open PR to `main` with `gh`, `main` auto-deploys (Unverified). Commit/push/PR/merge **only when the user explicitly asks**. Keep `.claude-flow/*` tooling files out of commits.

## 5. Main entry points
| Path | Role |
|---|---|
| `backend/server.js` | API, AI tool loop, order logic, pricing, staff auth, TTS proxy |
| `prompts/system-prompt.md` | RoboCap's behavior rules (ground rules, ordering/confirmation rules) |
| `data/menu.json`, `data/promotions.json` | Source of truth for menu & promotions |
| `frontend/index.html`, `app.js`, `style.css` | Customer UI (Menu, Orders tabs; Cart/Checkout views; RoboCap chat overlay) |
| `frontend/staff.html`, `staff.js`, `staff.css` | Staff dashboard |
| `.env.example` | Env var template |

## 6. Read these first (in order)
1. This file.
2. `05_CURRENT_STATE_AND_PROGRESS.md` and `13_NEXT_SESSION_HANDOFF.md` — where things stand and what to do next.
3. `08_USER_PREFERENCES_AND_WORKING_AGREEMENTS.md` — how this user wants work done (important: many UI iterations were redone because of missed preferences).
4. `02_TECHNICAL_ARCHITECTURE.md` and `03_PRODUCT_AND_BUSINESS_LOGIC.md` before changing code.
5. `04_DECISIONS_AND_RATIONALE.md` and `09_ISSUES_AND_LESSONS_LEARNED.md` before re-opening a settled question.
6. `12_OPEN_QUESTIONS_AND_MISSING_CONTEXT.md` for what is genuinely unknown.
Full index: `01`…`14` + `CHANGELOG.md` in this folder.

**Restore prompt:** `RESTORE_PROJECT_CONTEXT.md` (this folder) holds a complete copy-paste prompt that makes a fresh Claude Code/Cowork session
(any account) read these files, validate them against the code, and produce a "Project Context Restoration Report" without changing anything.
Update it whenever this folder's structure or the restore procedure changes.

## 7. How to reconstruct context in a fresh session
1. Read the files above.
2. `git log --oneline -20` and `git status` (expect uncommitted port/bubble/Figtree changes; `.claude-flow/*` noise is unrelated).
3. Read the code you are about to change — **code is authoritative for current behavior**; these docs capture intent and history.
4. Start the app (`cd backend && npm start`), open <http://localhost:4000>, and click through Menu → RoboCap banner → chat → add item → cart → checkout.
5. If something here contradicts the code, trust the code, then fix the doc and note it in `CHANGELOG.md`.

## 8. Top warnings
- `backend/.env` is an empty stray file; the real one is the **root** `.env` (loaded via `path.join(__dirname, "..", ".env")`).
- Custom-property gotcha: `--accent-gradient` must be redeclared inside `#view-chat` or buttons turn blue (see `09_…`).
- `LIVE_MODEL` must be a `generateContent`-capable model (e.g. `gemini-flash-lite-latest`); `*-live-*` models 404.
- Promotions use **server local time** (no timezone handling) — happy hour may misfire on a UTC host.
- Order sessions are in memory: a server restart empties every cart. On Render's default filesystem, `data/orders.json` is wiped on redeploy.
