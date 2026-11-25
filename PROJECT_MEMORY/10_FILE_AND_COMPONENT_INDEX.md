# 10 — File & Component Index

Status legend: **Active** · **Generated** · **Deprecated** · **Uncertain**. Line counts as of 2026-10-16.

## Root
| Path | Purpose | Status |
|---|---|---|
| `CLAUDE.md` | Project rules for Claude sessions (purpose, architecture, coding/security/token rules, scope discipline) + pointer to `PROJECT_MEMORY/` | Active |
| `README.md` (135 lines) | Setup, status, AI provider setup, deployment notes. **Partly stale** (four tabs/Chat tab) | Active, stale in places |
| `.env` | Real local secrets & config (gitignored). Never copy values | Active, sensitive |
| `.env.example` | Placeholder template (PORT default 4000 — uncommitted edit) | Active |
| `.gitignore` | ignores `.env`, `node_modules/`, `__pycache__/`, `.DS_Store`, `data/orders.json`, `.claude/settings.local.json` | Active |
| `PROJECT_MEMORY/` | This knowledge base | Active |
| `.claude/launch.json` | Dev-preview config: python static server :8123 over `frontend/` (no API) | Active, limited |
| `.claude/settings.local.json` | Machine-local tool permissions (gitignored; contains old curl allowances for :3000) | Active, local-only |
| `.claude-flow/` and `frontend/.claude-flow/`, `backend/.claude-flow/` | Claude-Flow tooling session/insight files; 52 tracked in git | Generated noise — never edit/stage |
| `.DS_Store` files | macOS | Generated |

## `backend/`
| Path | Purpose | Notes |
|---|---|---|
| `server.js` (2,221) | Entire backend: config, Gemini tool loop (`runAiTurn`, `executeTool`, `TOOL_DEFINITIONS`/`GEMINI_FUNCTION_DECLARATIONS`), order state & validation (`addItemToOrder`…), pricing (`recalculateTotal`), promotions, fulfillment setters, confirmation gate, persistence (`readSavedOrders`/`writeSavedOrders`), REST routes, TTS proxy, staff auth | Depends on `data/*.json`, `prompts/system-prompt.md`, root `.env` |
| `package.json`, `package-lock.json` | deps: express, dotenv; `npm start` | Active |
| `.env` (0 bytes) | Stray empty file | Uncertain / delete candidate |
| `node_modules/` | deps | Generated, ignored |

## `data/`
| Path | Purpose |
|---|---|
| `menu.json` (41 KB, 70 items) | Menu source of truth; fields documented in `03_…` |
| `promotions.json` | 3 promotions (2 active) |
| `orders.json` | Runtime confirmed-order log (gitignored, PII; created on first order if missing) |
| `.gitkeep` | placeholder |

## `prompts/`
| `system-prompt.md` (245 lines) | RoboCap persona, ground rules (1–8), scope, behaviour, recommendations, comparisons, promotions, ordering, confirmation, safety. The backend appends menu JSON, active promotions, and live order state at runtime |

## `frontend/`
| Path | Purpose |
|---|---|
| `index.html` (342) | All customer views & overlays (see `02_…`) |
| `app.js` (2,711) | All customer logic. Key functions: `sendChatMessage`, `appendMessage`, `appendReplyOptions` (+`REPLY_CHIP_RULES`), `appendItemList`/`buildChatItemCard`, `openItemCustomizeSheet[ForEdit]`, `appendCartSummary`/`renderCartSummaryBlock`, `playChatSplash`, `showTab/showView`, `closeChatWindow`, `initRobocapBanner`, speech-to-text block (~L1604), TTS block (~L121), `loadMenu/renderMenu`, `renderCart`, checkout (`selectFulfillmentType`, `renderReview`), `loadOrderHistory` |
| `style.css` (3,107) | Theme tokens (`:root` light/blue; `#view-chat` dark/orange, incl. `--accent-gradient`), chat ambient background (`#view-chat::before`), splash, banner (`.robocap-banner*`), bubbles, chips, item cards, sheet, cart, checkout, orders |
| `staff.html`, `staff.js` (227), `staff.css` | Staff dashboard (Basic Auth credentials in `sessionStorage`) |
| `assets/menu/*.jpg` (70) | Menu photos, referenced by `menu.json` `image` ("menu/<id>.jpg") |
| `assets/petpooja-logo.png` | header/staff logo |
| `assets/petpooja-logo-white.svg` | chat footer logo (user-supplied red/white version) |

## Components worth knowing by name
- **RoboCap banner** (`#robocapBanner`, `.robocap-banner*`): Menu-top entry; chips call `sendChatMessage` after `openChatFromBanner()`.
- **Chat overlay** (`#view-chat`): opens with `--chat-origin-x/y` from the banner; closes via `closeChatWindow()` (animation, then `showTab`).
- **Item customization sheet** (`#itemSheetBackdrop`): used for add and edit.
- **Order-locked banner** (`#orderLockedBanner`), `lockChatInput`, `disableChatHistoryInteractions`.
- **Quick-reply system:** `REPLY_CHIP_RULES` (`[pattern, icon, flavor]`); "primary" flavor = outlined orange.
- **Backend tool dispatcher:** `executeTool` switch (24 cases).

## Temp / external artefacts referenced by history (not in repo)
- `~/.claude/plans/cozy-watching-walrus.md` — old plan for the bakery-style chat reskin (Aug 18); **superseded** by the Figma redesign. Outside the repo; may not exist in a new account.
- `~/.claude/projects/-Users-sandeep-Documents-Claude-Projects-cafebot/*.jsonl` — Claude session transcripts (the source of recovered history; **not portable**).
- Menu image fetch script (`fetch-menu-images.js`) lived in a temporary scratchpad (2026-08-17) — **not preserved**; images are in `frontend/assets/menu/`.
