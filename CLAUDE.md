# CafeBot — Project Instructions

## Project Memory (read this first)

This project has a portable knowledge base in `PROJECT_MEMORY/`. It was written so a fresh Claude session
(even under a different account) can continue the work. Every new session must:

1. **Read `PROJECT_MEMORY/00_START_HERE.md` first**, then `05_CURRENT_STATE_AND_PROGRESS.md`, `08_USER_PREFERENCES_AND_WORKING_AGREEMENTS.md`, and `13_NEXT_SESSION_HANDOFF.md`.
2. Read the other relevant memory files (`02` architecture, `03` business logic, `04` decisions, `09` lessons, `12` open questions) **before any substantial work**.
3. **Inspect the actual code before trusting the docs.** Verified implementation is authoritative for *current behavior*; the docs preserve business intent and history.
4. Do not contradict a documented decision (`04_DECISIONS_AND_RATIONALE.md`) without explaining why and recording a new decision there.
5. **Update the memory files whenever significant knowledge changes**: tasks/status (`05`, `06`), architectural or behavior changes (`02`, `03`), decisions (`04`), bugs/fixes/lessons (`09`), preferences the user states (`08`), and a line in `CHANGELOG.md`. Refresh `13_NEXT_SESSION_HANDOFF.md` at the end of a work session.
6. Keep unresolved questions explicit in `12_OPEN_QUESTIONS_AND_MISSING_CONTEXT.md` — never guess; mark facts as Verified / Inferred / Unverified / Unknown.
7. **Never store secrets** (API keys, passwords, tokens, customer PII from `data/orders.json`) in `PROJECT_MEMORY/` or anywhere committed.
8. Don't overwrite or delete the existing instructions below or useful docs; merge carefully.

**Restoring context in a fresh session/account:** paste the prompt in `PROJECT_MEMORY/RESTORE_PROJECT_CONTEXT.md` (or the one-liner at its top).
It is read-only and ends with a restoration report. If you change the `PROJECT_MEMORY/` structure or this procedure, update that file too.

Key working agreements (details in `08_…`): do only what is asked; keep UI-only tasks away from backend/order logic;
commit/push/PR/merge **only when the user explicitly asks**; never stage `.claude-flow/*`; verify UI changes in the browser
(orange chat theme under `#view-chat` **and** the light/blue Menu theme) before saying a task is done.
Run the app with `cd backend && npm start` → http://localhost:4000 (default port is 4000).

*The sections below are the original project rules (2026-08-16). Where they conflict with current reality (e.g. the
"simple chatbot" scope, the architecture sketch), the current architecture is in `PROJECT_MEMORY/02_TECHNICAL_ARCHITECTURE.md`.*

## Purpose

CafeBot is a simple chatbot for a cafe. It answers customer questions about
the menu, hours, and orders using a small set of prompt templates and a
local data file — no heavy infrastructure, kept beginner-friendly and cheap
to run.

## Architecture

```
frontend/   Simple chat UI. Calls the backend API.
backend/    API server. Loads prompts + data, calls the LLM, returns a reply.
prompts/    Prompt templates used by the backend.
data/       Menu, FAQs, and other reference data the bot reads from.
.env        API keys and config (never committed).
```

Flow: user message → frontend → backend → (prompt + data + LLM) → reply → frontend.

## Coding Rules

- Do what's asked; nothing more, nothing less.
- Keep files small and readable — one clear responsibility per file.
- Prefer editing an existing file over creating a new one.
- No new frameworks, libraries, or services unless the task requires them.
- No speculative abstractions or config for features that don't exist yet.
- Match the style of surrounding code.

## Security Rules

- Never commit `.env` or any real API keys/secrets — use `.env.example` for placeholders.
- Validate all user input at the API boundary (frontend input, request bodies).
- Never put secrets or personal data in logs, prompts, or client-side code.
- Never execute or eval user-supplied input.

## Token-Saving Rules

- Keep prompts in `prompts/` short and specific — avoid restating context the model already has.
- Don't send the entire `data/` file to the LLM if only a subset is relevant — filter first.
- Avoid unnecessary back-and-forth calls; batch what can be batched.
- Prefer cheaper/smaller models for simple tasks (e.g., FAQ lookup) and reserve larger models for cases that need them.

## Scope Discipline

- Only modify the files needed for the current task. Do not touch unrelated
  files in `frontend/`, `backend/`, `prompts/`, or `data/` "while you're in there."
