# CafeBot

A simple chatbot project for a cafe: customers browse the menu, build an
order, and check out; staff track incoming orders on a small dashboard.

## Folder structure

- `prompts/system-prompt.md` — CafeBot's system prompt (behavior rules for the future AI integration)
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
- **The customer chat UI (`frontend/app.js`) is still mock-only** — it is
  not wired up to the backend yet. It shows canned replies, not real order
  data.
- No AI provider is connected yet. `/api/chat` returns a placeholder reply;
  `OPENAI_API_KEY` / `OPENAI_MODEL` in `.env` are reserved for that future
  work and aren't read by any code yet.
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
3. Serve the frontend as static files, e.g.:
   ```bash
   cd frontend
   python3 -m http.server 8123
   ```
   Then open `http://localhost:8123` for the chat UI, or
   `http://localhost:8123/staff.html` for the staff dashboard.
4. The staff dashboard calls the backend at a hardcoded URL — see
   `API_BASE` at the top of `frontend/staff.js`. Update it if your backend
   isn't running at `http://localhost:3000`.

## Deployment notes

- **Backend**: a standard Node/Express app (`backend/server.js`, `npm
  start`). Requires Node 18+. Set `PORT` via your host's environment
  variables (most platforms do this automatically).
- **Frontend**: static files with no build step — deploy `frontend/` to
  any static host. Before deploying, update `API_BASE` in
  `frontend/staff.js` to your backend's real URL (see above).
- **CORS**: the backend currently allows requests from any origin
  (`Access-Control-Allow-Origin: *`) so the frontend can call it from a
  different host/port during development. Tighten this to your actual
  frontend origin before a public deployment.
- **HTTPS is required for the staff dashboard to be safe**: HTTP Basic Auth
  sends the username/password base64-encoded (not encrypted) on every
  request — anyone on the network path can read them over plain HTTP.
  Only deploy the backend behind HTTPS.
- **`data/orders.json`**: this file accumulates real customer data (name,
  phone, delivery address) once the app is used, so it's gitignored. The
  backend creates it automatically on the first confirmed order if it
  doesn't already exist — no manual setup needed. For anything beyond
  light local use, consider moving this to a real database instead of a
  flat file.
- **Secrets**: never commit a real `.env` file (already gitignored).
  `data/orders.json` and `.claude/settings.local.json` are gitignored for
  the same reason — they hold runtime/local data, not shared config.
