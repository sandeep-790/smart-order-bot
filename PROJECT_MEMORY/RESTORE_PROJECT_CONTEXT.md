# RESTORE PROJECT CONTEXT — copy-paste prompt

**How to use:** open the project folder (the one containing `PROJECT_MEMORY/`) in a fresh Claude Code or Claude Cowork session —
any account — and paste **everything inside the fenced block below** as your first message.
If you cannot open the folder, you can instead paste only this one line:
`Read PROJECT_MEMORY/RESTORE_PROJECT_CONTEXT.md in the project folder and execute the prompt inside it.`

This file is self-contained: it does not depend on the original account, any earlier conversation, or any prompt stored elsewhere.
Maintenance rule: whenever the `PROJECT_MEMORY/` structure or the restoration procedure changes, update this file in the same change (and keep the file list in step 3 current).

---

````text
You are restoring context for an existing software project from its project folder. This is a READ-ONLY restoration task.
You have no memory of this project; do not assume any prior conversation, prior Claude response, or private account memory exists.
Everything you need is in the project folder. Use relative paths from the project root (the folder that contains PROJECT_MEMORY/).

## 0. Ground rules for this task
- Do NOT modify source code, configuration, data, or existing documentation. Do NOT delete, move, or rename files. Do NOT run deployments,
  migrations, installs that change the lockfile, destructive git commands, or anything that spends paid API credits.
- Do NOT commit, push, open or merge pull requests, or send messages to external systems.
- Do NOT copy, print, or ask me to paste secrets (API keys, passwords, tokens). If you see secrets in files such as `.env`, do not repeat their values.
- Do NOT invent facts. Label every claim as: Verified (you saw it in code/files/git/tool output this session), Documented (stated in PROJECT_MEMORY but not re-verified),
  Inferred (your reasoning), Unverified, or Unknown.
- Do NOT begin unrelated implementation work. After the report, wait for my instruction.
- Claude Code and Claude Cowork may load instructions differently. Do not assume `CLAUDE.md` was auto-loaded: read it explicitly.
  First inspect which tools you actually have (file read, shell, git, browser, etc.) and say which ones are available. If you cannot run shell commands,
  restore context from file reading alone and say which verification steps you had to skip.

## 1. Locate and read, in this order
1. `PROJECT_MEMORY/00_START_HERE.md` (entry point).
2. `CLAUDE.md` at the project root, if present — follow its project-specific instructions (it defines working rules; it is not a task).
3. All relevant files in `PROJECT_MEMORY/` (read each; if a listed file is missing, record it as a discrepancy and continue):
   - `01_PROJECT_OVERVIEW.md` — purpose, users, scope, limitations
   - `02_TECHNICAL_ARCHITECTURE.md` — stack, components, API surface, risks
   - `03_PRODUCT_AND_BUSINESS_LOGIC.md` — requirements, rules, workflows, implemented vs planned
   - `04_DECISIONS_AND_RATIONALE.md` — decision log and rejected approaches
   - `05_CURRENT_STATE_AND_PROGRESS.md` — completed / unverified / pending / bugs / next actions
   - `06_TASKS_ROADMAP_AND_BACKLOG.md` — owner-confirmed items vs audit recommendations
   - `07_DEVELOPMENT_AND_OPERATIONS.md` — setup, env var names, commands, troubleshooting, deployment
   - `08_USER_PREFERENCES_AND_WORKING_AGREEMENTS.md` — how the owner wants work done
   - `09_ISSUES_AND_LESSONS_LEARNED.md` — past bugs, root causes, outstanding investigations
   - `10_FILE_AND_COMPONENT_INDEX.md` — file map
   - `11_EXTERNAL_DEPENDENCIES_AND_INTEGRATIONS.md` — external services and what must be reconnected
   - `12_OPEN_QUESTIONS_AND_MISSING_CONTEXT.md` — what cannot be recovered; questions for the owner
   - `13_NEXT_SESSION_HANDOFF.md` — latest session state and best next action
   - `14_MIGRATION_READINESS_REPORT.md` — what was inspected/missing when the memory was written
   - `CHANGELOG.md` — recovered history
   Also list the folder (`PROJECT_MEMORY/`) and read any additional files you find there that are not named above.
4. `README.md` and `.env.example` (placeholders only; never read `.env` values aloud).

## 2. Validate against the real project (read-only)
Inspect the actual files and compare with what the memory says. At minimum:
- Directory tree (excluding dependency, cache and tooling-noise folders such as `node_modules/`, `.git/`, `.claude-flow/`).
- Dependency/manifest files (e.g. `backend/package.json`) and entry points named in 00_START_HERE.md.
- The main source files named in 10_FILE_AND_COMPONENT_INDEX.md: skim structure, exports/routes/tools, configuration constants, theme tokens.
- Spot-check at least 5 specific factual claims from 02 and 03 (e.g. route list, tool count, pricing constants, menu item count, promotion rules) against the code/data.
- Git state if git is available: `git status --short` (ignore tooling-noise paths), `git log --oneline -15`, current branch, and compare with 05 and 13.
- Read-only commands only. If checks require running the app or calling paid APIs, do not; mark them Unverified and list the exact command a human could run.

## 3. Reconstruct
From what you read and verified, reconstruct and be ready to explain: the project's purpose and background; users and requirements; architecture and workflows;
constraints and the owner's working agreements; what is complete, in progress, pending; important historical decisions and why; what should happen next.

## 4. Detect gaps
- Discrepancies between memory files and the real code/config/git state (cite file paths). Do not "fix" them now; list them.
- Missing conversation history; unavailable credentials; disconnected or environment-specific integrations (hosting, API keys, CLI logins, design tools);
  anything referenced by the memory that does not exist in this folder; context that exists only outside the folder.
- Anything in the memory that looks stale or contradictory.

## 5. Produce the "Project Context Restoration Report"
Reply in the chat (do not create files unless I ask) using exactly these sections:
1. Environment check — tools available, folder opened, files found/missing.
2. Project overview and objectives
3. Architecture and technology stack
4. Key business rules and product requirements
5. Important decisions and their rationale
6. Current implementation status — completed / implemented-but-unverified / in progress
7. Pending tasks, bugs, and blockers (separate owner-confirmed items from audit recommendations)
8. Development and testing instructions (exact commands; how to run; how it is verified today)
9. Working agreements — how I want you to work (from 08 and CLAUDE.md), including any rule that restricts git/deploy actions
10. Discrepancies found between memory and the real project (with evidence)
11. Missing context and required external access (credentials to configure, accounts to reconnect, questions for the owner)
12. Recommended next steps, in priority order, plus the single best next action
Keep each section tight; cite file paths; mark confidence labels (Verified / Documented / Inferred / Unverified / Unknown).

## 6. After the report
State "Context restored" and ask which task I want to start. Then:
- Do not begin implementation until I give an explicit instruction.
- When I do give a task, follow CLAUDE.md and 08_USER_PREFERENCES_AND_WORKING_AGREEMENTS.md, inspect the relevant code before editing, keep changes minimal,
  and verify them. Update the relevant PROJECT_MEMORY files (status, decisions, lessons, handoff, changelog) after meaningful work, as CLAUDE.md requires.
- Never store secrets in PROJECT_MEMORY or anywhere committed. Keep unresolved questions explicit instead of guessing.
````

---

## Notes for humans (not part of the prompt)
- Works in Claude Code (CLAUDE.md is usually auto-loaded but the prompt reads it explicitly anyway) and in Cowork (open the same folder; if file/shell tools differ, the prompt tells the session to say what it could not verify).
- The first message can be shortened to the one-line variant at the top if the folder is accessible.
- Expected output: a 12-section chat report, no file changes. If the session starts editing files, stop it and re-paste section 0.
- Transcripts, screenshots, `.env` values, and hosting dashboards do **not** transfer; see `12_OPEN_QUESTIONS_AND_MISSING_CONTEXT.md` for the recovery plan.
- Keep this file's file list in sync when documents are added, renamed, or removed.
