# 07 — Development & Operations

## Prerequisites
- Node.js ≥ 18 (developed on v24.15.0), npm, git, `gh` CLI (for PRs; authenticated as the repo owner).
- Accounts/keys (separate, not in repo): Google AI Studio API key (Gemini), Sarvam AI API key (TTS), a staff username/password of your choosing.
- macOS dotfile tip: `.env` is hidden in Finder (Cmd+Shift+.); edit via `open -e .env` or an editor.

## Install & run
```bash
cd backend
npm install
npm start            # node server.js  → http://localhost:4000
```
Open <http://localhost:4000> (customer app) and <http://localhost:4000/staff.html> (staff). The default port is **4000** (changed from 3000 on 2026-09-11; uncommitted at doc time).
To stop a running instance: `lsof -tiTCP:4000 -sTCP:LISTEN | xargs kill`.

## Environment variables (root `.env`; template `.env.example`)
| Name | Required | Purpose | Default |
|---|---|---|---|
| `PORT` | no | server port | 4000 |
| `STAFF_USERNAME`, `STAFF_PASSWORD` | yes for staff | HTTP Basic credentials; `/api/staff/*` returns 503 until both set | none |
| `GOOGLE_API_KEY` | for chat | Gemini key (chat replies say "AI isn't configured" if missing) | none |
| `LIVE_MODEL` | for chat | text model, e.g. `gemini-flash-lite-latest`; must support `generateContent` (no `*-live-*`) | none |
| `SARVAM_API_KEY` | for voice | Sarvam TTS key (voice silent if missing) | none |
| `SARVAM_TTS_SPEAKER` | no | lowercase speaker (e.g. `shubh`, `ritu`) | `shubh` |
| `SARVAM_TTS_MODEL` | no | | `bulbul:v3` |
Stale/unused in current code: `AI_API_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `LIVE_VOICE` (safe to delete).
`.env` is loaded from the **project root** (not `backend/`). Use placeholders only in docs; never commit `.env`.
List usable Gemini models: `curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GOOGLE_API_KEY"`.

## Dev commands
| Task | Command |
|---|---|
| Syntax-check frontend JS | `node -c frontend/app.js` (and `staff.js`) |
| Syntax-check backend | `node -c backend/server.js` |
| CSS brace balance (ad-hoc check used so far) | `python3 -c "s=open('frontend/style.css').read();print(s.count('{'),s.count('}'))"` |
| Menu API smoke test | `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/menu` |
| Lint / type-check / unit tests | **none exist** |
Note: `.claude/launch.json` defines a Python static server on :8123 for `frontend/` — it **cannot** reach the API (no backend). Use the Node server instead.
After editing `menu.json`, `promotions.json`, or `system-prompt.md`: **restart** the server (loaded once at startup).

## Manual verification checklist (what past sessions did)
1. Reload with cleared storage: browser console `localStorage.clear(); sessionStorage.clear(); location.reload()`.
2. Menu loads; banner visible; category jump button works.
3. Banner click → splash (≈10 s or "Start chatting →") → typing loader → welcome + 8 chips.
4. Send "recommend something" → item cards; tap **Add** → customization sheet; Add with gradient button (orange in chat).
5. Close chat (header X and splash X) → returns to Menu tab (regression test for the `closeChatWindow` event bug).
6. Checkout flow (pickup/delivery/dine-in) and `/staff.html` login.
7. Check console: only known Sarvam `502` errors are acceptable.
Mobile emulation used: 360×780 (Android) and 375px.

## Debugging & troubleshooting
| Symptom | Cause / fix |
|---|---|
| `EADDRINUSE :::<port>` | another process owns the port → kill it or change `PORT` |
| Chat says "AI isn't configured" | `GOOGLE_API_KEY`/`LIVE_MODEL` missing in root `.env`; restart |
| Gemini 404 "not supported for generateContent" | `LIVE_MODEL` is a Live-API model; use `gemini-flash-lite-latest` |
| Gemini 404 "no longer available" | dated model retired; use a `-latest` alias |
| Voice silent | no `SARVAM_API_KEY`, or Sarvam 502 (frontend fails silently by design) |
| Speaker 400 from Sarvam | speaker must be lowercase (server lowercases it) |
| Staff API 503 | `STAFF_*` unset |
| Chat window blank after close | event passed as `destinationTab` (fixed; use `() => closeChatWindow()`) |
| Chat buttons blue instead of orange | `--accent-gradient` not redeclared in `#view-chat` |
| `new URL()` throws on relative API_BASE | `apiGet` must pass `window.location.origin` base |

## Deployment (as documented/recovered — not verified now)
- Single Render **web service** running `backend/` (Node ≥18); `PORT` is injected by Render. Set `STAFF_*`, `GOOGLE_API_KEY`, `LIVE_MODEL`, `SARVAM_*` in Render → Environment (no `.env` on the server). URL seen in history: `https://smart-order-bot.onrender.com`.
- Whether Render auto-deploys from `main` is **Unverified** (no `render.yaml`/CI in repo). The 2026-09-04 "changes not on production" incident was an unmerged PR.
- Use HTTPS only (Basic Auth is not encrypted). Render's filesystem is ephemeral → `data/orders.json` is lost on redeploy unless a disk is attached.

## Git/PR workflow used
- Feature branch `feature/gemini-native-live-api` → PR to `main` → `gh pr merge --merge`. Remote: `https://github.com/sandeep-790/smart-order-bot` (single collaborator; GitHub web UI once failed with "must be a collaborator" → use `gh`).
- GitHub auto-deletes the head branch after merge; recreate/push anew for the next PR.
- Commit messages: descriptive subject + body; Co-Authored-By trailer only if `.claude/settings.json` sets attribution (a session reminder may supply one — follow it).
- Stage specific files, never `git add -A` (tooling noise in `.claude-flow/`).
- Never `--no-verify`; no destructive git without asking.

## Credentials that must be configured separately in a new environment
Gemini key, Sarvam key, staff credentials, Render env vars, GitHub auth for `gh`. None are stored in this repo or memory folder.
