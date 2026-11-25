# 09 — Issues & Lessons Learned

Format: **Symptom → root cause → fix/workaround.** Dates from transcript/git. No credentials included.

## Frontend / CSS
1. **Colored background blobs rendered as a muddy single blob** (2026-09-04) → animating `background-position` across multiple radial-gradient layers whose positions were not baked into the gradient (`at X% Y%`). → Bake positions into each gradient; animate only `filter: hue-rotate()/brightness()` on the whole pseudo-element. Later replaced by the `mask-image` dot approach.
2. **Gradient buttons were blue inside the orange chat window** (2026-09-08) → CSS custom properties resolve `var()` at the **declaring** element; `--accent-gradient` declared only on `:root` baked in the blue `--accent`. → Redeclare it inside `#view-chat`. Diagnose with `getComputedStyle(el).getPropertyValue('--accent-gradient')`. *Lesson: after theme-scoped token work, test in both themes and say so.*
3. **Chat close left a blank screen** (found 2026-09-04) → `addEventListener("click", closeChatWindow)` passed the Event as `destinationTab`, so `showTab(event)` matched no panel. → `() => closeChatWindow()`.
4. **Send button cropped on Android** (2026-09-04) → likely no safe-area/edge clearance on the composer (Inferred; the photo showed a hard-cut right edge). → `viewport-fit=cover` + `padding: … calc(12px + env(safe-area-inset-*))`. Real-device confirmation pending.
5. **Menu banner swallowed by `renderMenu()` rebuilds** (avoided in design) → categories now render into `#menuCategoriesContainer`, a sibling below the persistent banner; `loadMenu/renderMenu` must not target `#menuList`.
6. **Order summary + "Your order" card both shown after chat checkout** (2026-09-04) → fixed to show only the card (details in transcript; verify in `sendChatMessage`).
7. **"Add more" returned bestsellers including cart items** (2026-09-04) → `get_bestsellers` doesn't exclude cart items; frontend `limitNextItemListTo` + exclusion safety net added in `sendChatMessage`.
8. **Reply chip styling:** filled orange primary chips looked wrong → outlined orange; filled look reserved for gradient CTAs.
9. **Dot-grid tuning:** many rounds (20→12→8→6→7→5 px; opacity 0.08→0.025→0.25→…). Final design uses masked colored dots; see D22. *Lesson: when the user gives a numeric value, apply it literally and don't re-interpret.*
10. **HEIC attachments** can't be read directly: convert with `sips -s format png in.HEIC --out out.png`; crop with `sips -c <height> <width> --cropOffset <top> <left>` (note **height-first / y-then-x** order).

## Voice (STT/TTS)
11. **Android repeated words in speech-to-text** (2026-08-17/18) → Android's recognizer doesn't support continuous mode properly; use non-continuous + restart-on-end there (see `app.js` ~L1618).
12. **Mic failing after the text input had focus** → blur the input before `recognition.start()`; guard `start()` with try/catch.
13. **Keyboard opened automatically after each bot reply** → stopped auto-focusing the input.
14. **TTS delay** → streamed `GET /api/tts` consumed by `<audio src>`; TTS fetch started during the typing-indicator pause; summary/confirmation use short spoken lines.
15. **Sarvam speaker 400s** → speaker names are lowercase-only; server lowercases env value.
16. **Intermittent Sarvam `502`** (outstanding) → frontend deliberately fails silent. Cause unknown (upstream, quota, key, or payload).

## AI / backend
17. **Gemini `generateContent` rejects a `function` role** → send tool results as a `user` turn of `functionResponse` parts; echo the model's `functionCall` turn first.
18. **`gemini-3.1-flash-live-preview` 404s** (2026-08-19) → Live API (WebSocket) model; use `gemini-flash-lite-latest`.
19. **Model retirement:** `gemini-2.0-flash` and `gemini-2.5-flash/-lite` were gone by 2026-08; prefer `-latest` aliases. A web-search result once returned an implausible model name ("gemini-3.6-flash") — verify against the live `models` list.
20. **Silent quantity 2** → prompt ground rule 8 + `present_quantity_options`.
21. **Perf:** see D16. Dominant cause: 1.5 s artificial skeleton delay; rest structural. Rejected: caching, thinkingBudget.
22. `new URL(path)` throws on relative `API_BASE` → pass `window.location.origin`.

## Deployment / process
23. **Render "Cannot GET /"** (2026-08-16) → backend didn't serve frontend → `express.static`.
24. **Ephemeral filesystem** → `data/orders.json` lost on redeploy; documented in README, not solved.
25. **Prod not updating** (2026-09-04) → PR #24 never merged. *Lesson: check PR state first.*
26. **"Pull request creation failed. Validation failed: must be a collaborator"** → GitHub web UI under a non-collaborator account (Inferred); use `gh pr create`/`gh pr merge` as owner `sandeep-790`.
27. **Stale local `main`** made `main..branch` look 19 commits ahead → `git fetch origin` first.
28. **Stray 0-byte `backend/backend`** committed accidentally (2026-09-03) → removed in `78b1d97`.
29. **Python static preview (`.claude/launch.json`, :8123) can't call the API** → use Node server.
30. **`.claude-flow/*` tooling files** pollute `git status`; 52 are tracked. Never stage them.
31. **PORT collisions** (3000 busy) → default moved to 4000 (2026-09-11).

## Security / reliability / maintainability concerns
- Real keys live in root `.env` and were echoed into AI transcripts → rotate (see `14_…`).
- Weak local staff password in `.env`; Basic Auth only safe on HTTPS.
- `data/orders.json` stores PII (name/phone/address) in plaintext, gitignored; 14 records existed locally at doc time (contents not reproduced here).
- CORS `*`; no rate limiting; Gemini key in URL query string; TTS text in query string.
- Giant single files; no tests; manual verification only.
- Promotion time windows use server-local time.

## Outstanding investigations
Sarvam 502 root cause; production env/auto-deploy state; Android send-button fix on device.
