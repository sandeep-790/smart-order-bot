# 08 — User Preferences & Working Agreements

Source: the original Claude Code conversation transcript (186 user messages, 2026-08-16 → 2026-10-16) plus `CLAUDE.md`.
"Explicit" = the user said it. "Inferred" = pattern observed, never stated. Message numbers (#n) refer to that transcript order.
Owner: Sandeep Kurapati (product owner + hands-on tester; communicates in terse bullet lists, often with screenshots).

## Explicit — how to work
- **Do exactly what is asked; nothing more.** "Do not make any other changes in the code yet" (#76); "Fix only issues in the chat interface. Do not add new features" (#8); "Do not change unrelated code" (#15); also `CLAUDE.md` Scope Discipline.
- **For big or risky changes: list the plan/changes first and wait for approval** — "List down all the changes you require before proceeding. I will check and approve" (#36); "First tell me 1–5 … Do not make code changes yet" (#128); "Give me some options before adding it to code" (#115); "before implementing changes, mention the reason why it is slow" (#126). Large multi-part UI specs were handled via Plan Mode (Recovered from session summaries).
- **Don't touch backend/APIs/order logic when the task is UI** — "Do NOT modify the existing backend, APIs, order logic, menu logic, or authentication" (#128); "Do not make any changes in the functional flow" (#98); "do not make any changes to existing code that runs on the AI" (#37).
- **Git actions only on request, one step at a time:** "commit this" (#152), "push it" (#153), "open the pr" (#161), "merge it" (#162/#182). PRs must be **ready for review, not draft** (create-pr command text). Never push/merge on your own.
- **Local-server checks:** "Do not check on local server without permission on each change. Ask me before you check on the local server" (#134, 2026-09-03). Later the user explicitly asked for tests ("go ahead and run the test cases" #145) and rebuked a missed verification ("You failed the testing. fix now" #179). → Practical rule: verify before claiming done (the user expects it), and when in doubt about starting servers ask once/state what you are doing.
- **Keep secrets out of chat/repo:** the assistant asked the user to paste API keys into `.env` themselves; keep it that way (`CLAUDE.md` Security Rules).
- **Explain reasons / teach:** the user asks "Whats the issue", "Make me understand where exactly I am standing" (#39) — give diagnosis before action, in plain language.
- **Provide options for decisions** (AI providers #44, taglines/disclaimer wording #115).
- **Keep branch separate for risky experiments** (#118: "keep the branch different").

## Explicit — product/UX/design preferences
- AI: **never hallucinate**; confirm before deciding; offer tappable options instead of making users type (#50); every reply ends with a follow-up question (#67); human-friendly acknowledgements like "Okay!" (#63); name **RoboCap**, "Your virtual Captain" (#54); RoboCap should feel like **intelligence, not human chat** (#104).
- Customer-facing errors must be friendly, never technical, with **Go to menu** and **Retry** actions (#113).
- Chat is **dark-mode only, orange accent**; **no light theme** for the chat window (#133). Menu/Orders remain light/blue (scoped decision, Inferred from the follow-up work).
- Bot and user bubbles **pure black**; bot bubble **no border**, **full chat width**; bot replies in **Figtree** (#165, #183, #184).
- Background: modern dotted pattern, subtle. Final instruction (#173–#176): **keep the background black; the dots themselves carry the corner colors**, with a gradient falloff, dark/low-visibility, tighter spacing. Many opacity tweaks led here (see D22). Splash/greeting blobs subdued (peak opacity 0.3).
- Icons: real icons, not emojis, in UI chrome (#54); name icon must be **outlined**, not filled (#177). Filled solid buttons look bad as chips; primary chips = **outlined orange**; real CTA buttons use the **gradient** (#146, #178).
- Customization sheet: size as **radio rows** (rejected pills, #146); veg/non-veg indicator before item name; Add button price multiplies by quantity; close button must not overlap price.
- Item cards: price + Add pinned to bottom; Add is outlined; veg indicator before the name only (not on the image); badges (Bestseller/Recommended/spicy) on the image.
- Order summary card: no Type/Extras labels, no tax/total lines, no close button; "Change" reopens customization; "Add more" asks for 2 recs not in cart.
- Special instructions prompt offers **only** "No special instructions" (#144).
- Voice: Indian-English, humane, **instant**; read "Idli 4 pieces", "1 quantity of Medu Vada"; order summary/confirmation get short scripted speech; keyboard must **not** auto-open after a reply; mic is one button that cycles mic → stop → send; the transcript is never auto-sent (owner spec 2026-11-25).
- Disclaimer wording: "RoboCap is always learning. Powered by [Petpooja logo]" in the footer; small logo aligned to text (#116, #180). Petpooja logo SVG supplied by the user (white/red version).
- Menu banner replaces the floater; content: RoboCap name + image, "Virtual Captain", "AI Assistant", AI-feeling background, quick questions (#163).
- Chat opens/closes with a grow-from-origin animation anchored to the entry element.

## Explicit — project constraints
`CLAUDE.md` (project): beginner-friendly; no new frameworks/libraries/services unless required; no speculative abstractions; keep files small; match surrounding style; validate input at API boundary; no secrets in logs/prompts/client; filter data before sending to the LLM; prefer cheaper models for simple tasks.
`PROJECT_MEMORY` rules (this folder): see root `CLAUDE.md`.
(Outside the repo: `~/CLAUDE.md` and `~/.claude/CLAUDE.md` contain unrelated "Ruflo" swarm instructions for this user's machine — not part of the project; do not assume they exist in another account.)

## Approaches previously rejected
Filled size pills; light theme for chat; bakery palette from the standalone HTML (kept own brand, later superseded by Figma); sticky cart bar (replaced by composer cart icon + badge); multi-option "special instructions" chips; draggable floater (replaced by banner); Gemini TTS (rolled back to Sarvam); animated `background-position` background.

## Inferred preferences (unconfirmed)
- Prefers short status updates and a brief end summary; screenshot-based verification.
- Iterates in rapid small steps; expects each requested number/value to be followed literally (e.g. "dot opacity should remain 0.25", "reduce peak opacity 0.5 → 0.3").
- Wants consistency: a visual rule applied once should apply to all analogous components (e.g. "All filled buttons like Add…").
- Tests on real devices (Android phone photo, online testers on Render).
