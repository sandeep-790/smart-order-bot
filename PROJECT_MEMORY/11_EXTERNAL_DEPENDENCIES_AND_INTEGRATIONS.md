# 11 — External Dependencies & Integrations

No credentials appear here. Everything below must be (re)configured in any new environment.

## Runtime services
| Service | Purpose | Direction | Endpoint | Auth | Config |
|---|---|---|---|---|---|
| **Google Gemini API** (`generativelanguage.googleapis.com/v1beta`) | Chat reasoning + tool-calling (`models/{LIVE_MODEL}:generateContent`) | server → Google (prompt ≈ system prompt + 70-item menu JSON + live order + 24 tool schemas, ≈17k tokens/call, measured 2026-08-19) | `POST …/models/{model}:generateContent?key=…` | API key in **query string** | `GOOGLE_API_KEY`, `LIVE_MODEL` |
| **Sarvam AI** Bulbul TTS | Spoken replies | server → Sarvam; MP3 streamed to browser via `GET /api/tts` | `POST https://api.sarvam.ai/text-to-speech/stream` (`api-subscription-key` header) | API key header | `SARVAM_API_KEY`, `SARVAM_TTS_SPEAKER`, `SARVAM_TTS_MODEL`; payload: `language_code:"en-IN"`, `output_audio_codec:"mp3"`, `enable_preprocessing:true`, max 3500 chars |
| **Google Fonts** (Figtree 400/500/600/700) | Chat typography | browser → fonts.googleapis.com | CSS `<link>` in `index.html` | none | — |
| **Browser Web Speech API** | Speech-to-text (`en-IN`) | in-browser | — | mic permission | no server involvement; unsupported browsers hide the mic |

Limits/quotas: Gemini free tier rate limits (exact values **Unknown**); Sarvam limits only the 3500-char text cap known; Sarvam 502s observed in dev. Latency floor ≈0.85–1.0 s per Gemini call.
Failure modes handled: missing keys → friendly placeholder replies (chat) / silent voice; Gemini errors → "Sorry, I couldn't reach the AI service…"; frontend shows a friendly fallback with Go-to-menu/Retry.

## Hosting & infrastructure (outside repo)
| Item | Status |
|---|---|
| **Render** web service `smart-order-bot` → `https://smart-order-bot.onrender.com` | Existed 2026-08/09 (Recovered). Plan, auto-deploy source branch, env vars, persistent disk: **Unknown** |
| **GitHub** repo `sandeep-790/smart-order-bot` (origin) | Active; single collaborator (owner); 29 merged PRs; no branch protection (checked 2026-09-04); no workflows |
| `gh` CLI | used for PR create/merge; needs login as owner |
| **Figma** file "Chatbot" (`WpvQjNNUFcoVUHmmQ5jOh1`, node `693-4011`) | Source of the dark redesign tokens (Recovered); access requires the owner's Figma account |
| `RoboCap Standalone.html` (~/Downloads) | One-off design reference from 2026-08-18; not preserved |
| Petpooja branding assets | in `frontend/assets/` |

## Webhooks/events/queues
None.

## Dependencies on accounts/subscriptions
Google AI Studio account/key; Sarvam account/key; Render account; GitHub account; Figma access (design only).

## Must be reconnected in a new environment
1. Create `.env` from `.env.example` and fill `GOOGLE_API_KEY`, `LIVE_MODEL`, `SARVAM_*`, `STAFF_*`.
2. Authenticate `gh` as the repo owner (or fork and re-point `origin`).
3. Recreate Render service (or equivalent) with the same env vars; attach a persistent disk or add a DB for orders.
4. (Optional) Figma MCP/connector if redesign work resumes.
