# CafeBot

A simple chatbot project for a cafe: customers browse the menu, build an
order, and check out; staff track incoming orders on a small dashboard.

## Folder structure

- `prompts/system-prompt.md` — CafeBot's system prompt (behavior rules the AI provider is grounded in)
- `data/menu.json` — menu items, prices, sizes, options
- `data/promotions.json` — promotions and their eligibility rules
- `data/orders.json` — confirmed orders, written by the backend at runtime (gitignored — see Deployment notes)
- `frontend/index.html`, `app.js`, `style.css` — the customer chat UI
- `frontend/staff.html`, `staff.js`, `staff.css` — the staff order dashboard
- `backend/server.js` — the API server (Express)
- `.env.example` — template for environment variables (copy to `.env` and fill in your values)

## Current status

- The backend implements the full ordering flow (menu lookup, cart,
  promotions, pickup/delivery details, address confirmation, deterministic
  pricing, explicit checkout confirmation, order persistence) — see
  `backend/server.js` for the full route list.
- The backend also serves the frontend itself (`express.static`), so
  visiting the backend's URL directly gives you the whole app — no
  separate frontend host needed.
- The customer UI has four tabs, all fully wired to the real backend:
  **Menu, Cart, and Checkout** call the order endpoints directly
  (add/modify/remove items, promotions, pickup/delivery with address
  confirmation, review, confirmation-gated checkout); the **Chat** tab
  sends free text to `POST /api/chat`, which calls Google's native Gemini
  API directly (see `GOOGLE_API_KEY` / `LIVE_MODEL` in `.env`) with
  tool-calling wired to those same order actions, so a customer can do
  everything through conversation instead of the buttons/forms if they
  prefer. RoboCap's spoken replies (`POST /api/tts`) use Sarvam AI's
  Bulbul text-to-speech (`SARVAM_API_KEY` / `SARVAM_TTS_SPEAKER` /
  `SARVAM_TTS_MODEL` in `.env`).
- **Without `GOOGLE_API_KEY` set, the Chat tab replies with a clear
  "AI isn't configured" message**, and without `SARVAM_API_KEY` set voice
  stays silent, instead of erroring — see "AI provider setup" below to turn
  these on. Menu/Cart/Checkout work either way, since they don't depend on
  the AI at all.
- **The staff dashboard is protected by HTTP Basic Auth** (`STAFF_USERNAME`
  / `STAFF_PASSWORD` in `.env`). The backend fails closed — every
  `/api/staff/*` request is rejected until both are set. There's no user
  database or sessions, just one shared username/password, which is
  appropriate for a small single-location cafe but won't scale to
  per-employee accounts.

## Getting started (local development)

1. Copy `.env.example` to `.env` (in the project root) and fill in your
   values. `PORT` defaults to `3000` if omitted, but `STAFF_USERNAME` and
   `STAFF_PASSWORD` are required — the staff dashboard won't work without
   them (the backend logs a warning on startup if they're missing).
2. Install and run the backend:
   ```bash
   cd backend
   npm install
   npm start
   ```
3. Open `http://localhost:3000` for the customer app, or
   `http://localhost:3000/staff.html` for the staff dashboard — the
   backend serves both, so that's the only URL you need.

   (If you ever want to run the frontend from a separate static server
   instead — e.g. `python3 -m http.server` in `frontend/` — you'll need to
   hardcode the backend's URL in `API_BASE` at the top of `frontend/app.js`
   and `frontend/staff.js` first, since it defaults to a relative/same-
   origin path.)

## AI provider setup

The Chat tab runs on Google's native Gemini API directly (not an
OpenAI-compatible shim) — `GOOGLE_API_KEY` and `LIVE_MODEL` in `.env`.
`.env.example` is pre-filled for **Gemini's free tier** (no credit card
required):

1. Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Paste it into `GOOGLE_API_KEY` in your `.env`.
3. `LIVE_MODEL` (the text model used for chat replies and tool-calling)
   defaults to `gemini-flash-lite-latest` — a "-latest" alias, which
   auto-points at whatever Google currently has live. Google deprecates
   dated model names often (`gemini-2.0-flash` and even
   `gemini-2.5-flash`/`-lite` were already gone as of 2026-08), so prefer
   `-latest` aliases over a specific dated one. If you ever get a `404`
   with "no longer available", list what your key can actually use:
   ```bash
   curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GOOGLE_API_KEY"
   ```
   Note: names containing `-live-` (e.g. `gemini-3.1-flash-live-preview`)
   are Gemini's real-time WebSocket Live API and are **not** compatible
   with the standard `generateContent` endpoint this app uses — don't set
   `LIVE_MODEL` to one of those.
4. Restart the backend (`npm start`).

RoboCap's spoken replies run on Sarvam AI's Bulbul text-to-speech —
`SARVAM_API_KEY`, `SARVAM_TTS_SPEAKER`, `SARVAM_TTS_MODEL` in `.env`:

1. Get a key at [sarvam.ai](https://www.sarvam.ai).
2. Paste it into `SARVAM_API_KEY` in your `.env`.
3. `SARVAM_TTS_SPEAKER` (lowercase speaker name, e.g. `shubh`, `ritu`) and
   `SARVAM_TTS_MODEL` (defaults to `bulbul:v3`) pick the voice.
4. Restart the backend (`npm start`).

## Deployment notes

- **One deployment, not two**: the backend serves the frontend itself, so
  deploying `backend/` (e.g. to Render, Railway, Fly.io) is all you need —
  there's no separate static site to host. Requires Node 18+. Set `PORT`
  via your host's environment variables (most platforms do this
  automatically); set `STAFF_USERNAME`/`STAFF_PASSWORD`,
  `GOOGLE_API_KEY`/`LIVE_MODEL`, and
  `SARVAM_API_KEY`/`SARVAM_TTS_SPEAKER`/`SARVAM_TTS_MODEL` there too, since there's no
  `.env` file on the server (see the platform's own dashboard for adding
  environment variables).
- **CORS**: the backend currently allows requests from any origin
  (`Access-Control-Allow-Origin: *`). Harmless now that frontend and
  backend are same-origin by default, but tighten this if you ever split
  them again for a public deployment.
- **HTTPS is required for the staff dashboard to be safe**: HTTP Basic Auth
  sends the username/password base64-encoded (not encrypted) on every
  request — anyone on the network path can read them over plain HTTP.
  Only deploy the backend behind HTTPS.
- **`data/orders.json`**: this file accumulates real customer data (name,
  phone, delivery address) once the app is used, so it's gitignored. The
  backend creates it automatically on the first confirmed order if it
  doesn't already exist — no manual setup needed. **Many hosting platforms
  (including Render's free/standard web services) use an ephemeral
  filesystem** — every redeploy or restart wipes this file, silently
  losing all order history, unless you've attached a persistent disk. For
  anything beyond light local use, consider moving this to a real
  database instead of a flat file.
- **Secrets**: never commit a real `.env` file (already gitignored).
  `data/orders.json` and `.claude/settings.local.json` are gitignored for
  the same reason — they hold runtime/local data, not shared config.
