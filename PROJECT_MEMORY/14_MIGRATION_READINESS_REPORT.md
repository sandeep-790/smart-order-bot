# 14 — Migration Readiness Report

Date: 2026-10-16 · Performed by: Claude (Sonnet 5.5) in the original account's Claude Code session.

## Verdict: **READY WITH LIMITATIONS**
A fresh Claude session can understand, run, debug, and continue this project from the repository alone. It cannot recover (a) screenshots/Figma references behind past visual requests, (b) the original transcripts, (c) production/hosting state, or (d) secret values. These are listed in `12_OPEN_QUESTIONS_AND_MISSING_CONTEXT.md`.

## Files created or updated
Created (16 + restore prompt): `PROJECT_MEMORY/RESTORE_PROJECT_CONTEXT.md` (see "Restore prompt" below), `PROJECT_MEMORY/00_START_HERE.md`, `01_PROJECT_OVERVIEW.md`, `02_TECHNICAL_ARCHITECTURE.md`, `03_PRODUCT_AND_BUSINESS_LOGIC.md`, `04_DECISIONS_AND_RATIONALE.md`, `05_CURRENT_STATE_AND_PROGRESS.md`, `06_TASKS_ROADMAP_AND_BACKLOG.md`, `07_DEVELOPMENT_AND_OPERATIONS.md`, `08_USER_PREFERENCES_AND_WORKING_AGREEMENTS.md`, `09_ISSUES_AND_LESSONS_LEARNED.md`, `10_FILE_AND_COMPONENT_INDEX.md`, `11_EXTERNAL_DEPENDENCIES_AND_INTEGRATIONS.md`, `12_OPEN_QUESTIONS_AND_MISSING_CONTEXT.md`, `13_NEXT_SESSION_HANDOFF.md`, `CHANGELOG.md`, and this report.
Updated (1): root `CLAUDE.md` — a "Project Memory" section was **inserted at the top**; all original rules retained verbatim below it.
Not created: `COWORK_INSTRUCTIONS.md` — this project is worked on through Claude Code (desktop app, `CLAUDE.md`-based), not Cowork. The Markdown files remain usable without automatic instruction loading (open `00_START_HERE.md` manually).

## Sources actually inspected
- Repository files: `README.md`, `CLAUDE.md`, `.env.example`, `.env` (keys/names only — values never copied), `.gitignore`, `backend/package.json`, `backend/server.js` (read in large part: config, middleware, AI loop, tool dispatcher, pricing, promotions, fulfillment, confirmation, persistence, chat/TTS/order/staff routes), `prompts/system-prompt.md` (section list + key rules), `data/menu.json` (structure + statistics), `data/promotions.json` (full), `data/orders.json` (record count only), `frontend/index.html` (structure/IDs), `frontend/app.js` (function/constant index, selected sections), `frontend/style.css` (theme tokens, relevant sections), `frontend/staff.js` (function list), `.claude/launch.json`, directory tree.
- Git: full log (40 commits), branches, remotes (credentials stripped), status, diffs stats, `gh pr list` (29 PRs).
- Claude session history: **2 project transcripts** in `~/.claude/projects/…/` — the main one (127 MB; **all 186 user messages read**, several in full) plus targeted assistant messages for: AI-provider choice, deployment/Render, Gemini-Live→Sarvam rollback, performance diagnosis, production-not-updating incident, API inventory. The second transcript (1 message) had no content of value. Session-start context summaries were available but only partially re-read; this session's own earlier work was known from its in-context summary.
- Auto-memory directory: empty. A stale plan file (`~/.claude/plans/cozy-watching-walrus.md`) was noted but is outside the repo.

## Not accessible / not examined
- Attached images and files (Figma frames, `RoboCap Standalone.html`, `IMG_4904.HEIC` beyond what was seen at the time, Petpooja SVG).
- Render/GitHub/Figma dashboards; production environment variables and deployment settings.
- Assistant-side reasoning for most UI polish rounds (the final code and commit history stand in for them); the middle of `app.js`/`style.css` was not read line by line.
- Live API behavior was not re-tested during this documentation exercise (no keys were used).
- Real-device (Android/iOS) behavior.

## Important context recovered
Complete chronological owner requirements (Aug 16 → Oct 16), product rules and ground rules for the AI, all major technical decisions with alternatives/rationale (provider, TTS, deployment, theming, performance), bug history with root causes, working preferences/rejected approaches, API/tool inventory, deployment history (Render), PR history, and the exact uncommitted state.

## Important context still missing
See `12_…` §A–B: reference images/Figma, production state, key rotation status, owner answers (13 questions), Sarvam 502 cause, menu-image provenance.

## Verification performed
- Cross-checked counts against code: 24 tools (`executeTool` switch), 20 REST routes, 70 menu items (categories, flags), 3 promotions (2 active), line counts, 29 merged PRs.
- Verified wording of the "Place order" button behavior in `frontend/app.js` and corrected the draft doc accordingly; verified no auto-apply of promotions and no timezone handling.
- Checked that every `NN_*.md`/`CHANGELOG.md` reference in the docs points to a file that exists (after this report was added).
- Confirmed the numeric/behavioral claims that came from transcripts are labeled **Recovered**/**Inferred**/**Unverified** where not code-verified.

## Security checks performed
- Programmatic scan of all new docs and `CLAUDE.md` for every value in `.env`: **no secret value present**. The only string matches were non-secret model names (`gemini-flash-lite-latest`, `bulbul:v3`).
- Regex scan for API-key-shaped strings (`AIza…`, `sk_…`, `AQ.…`): **none**.
- Scan for customer PII from `data/orders.json` (names, phones, addresses): **no phone/address hits**; only generic words ("Customer", "Test") and the owner's own name matched.
- `.env` is gitignored and untracked (`git ls-files` shows none). `PROJECT_MEMORY/` itself is untracked and uncommitted.
- ⚠ **Security finding:** real Google and Sarvam API keys and a weak staff password are in the local root `.env`, and `.env` content was displayed in AI-session tool output (during the 2026-09-11 port change and earlier setup). **Rotate those keys and the staff password** before sharing transcripts or deploying; see `06_…` B1.

## Application preservation
No application code or asset was modified by this task. The only tracked file changed is `CLAUDE.md` (insertion at top). Pre-existing uncommitted app changes (port 4000, bubble/Figtree) are from earlier work and are documented in `05_…`/`13_…`; their file mtimes (Sep 4–11) predate this exercise. Nothing was committed, pushed, or deployed.

## Incomplete work / caveats
- Documents were written from a recoverable subset of history; they are accurate to the code as of 2026-10-16 but will drift — update them per `CLAUDE.md`.
- `README.md` was deliberately left as-is (stale in places) per "do not modify application/docs unnecessarily"; flagged in backlog B11.
- Testing instructions are manual only (no test suite exists).

## Restore prompt
`PROJECT_MEMORY/RESTORE_PROJECT_CONTEXT.md` contains the complete, self-contained prompt (inside one fenced block) plus a one-line variant. It instructs a fresh
Claude Code/Cowork session to: read `00_START_HERE.md`, then `CLAUDE.md`, then every file in `PROJECT_MEMORY/`; validate against the real code/config/git read-only;
detect discrepancies and missing context; avoid inventing facts or changing anything; and output a 12-section "Project Context Restoration Report" before waiting for a task.
It is referenced from `00_START_HERE.md` and `CLAUDE.md`. Verified present and complete at 2026-10-16 (see verification below).

## How to open this in another Claude account
1. Copy the **whole project folder** (it includes `PROJECT_MEMORY/` and `CLAUDE.md`) to the new machine/account, **or** get the owner's approval to commit `PROJECT_MEMORY/` and `CLAUDE.md` and clone from `https://github.com/sandeep-790/smart-order-bot`. (Do **not** copy `.env`; recreate it from `.env.example` with new keys. The transcripts under `~/.claude/projects/` do not transfer.)
2. Open the folder in Claude Code. `CLAUDE.md` loads automatically and points to `PROJECT_MEMORY/00_START_HERE.md`. If it doesn't, paste: *"Read PROJECT_MEMORY/00_START_HERE.md and follow it."*
3. `cd backend && npm install && npm start`, open <http://localhost:4000>, run the checklist in `07_…`.
4. For a clean start, paste the prompt from `PROJECT_MEMORY/RESTORE_PROJECT_CONTEXT.md` (it ends with a restoration report), then optionally the continuation prompt from `13_NEXT_SESSION_HANDOFF.md`.
5. Ask the owner the questions in `12_…` §B before touching deployment, keys, or git history.
