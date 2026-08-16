# CafeBot — Project Instructions

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
