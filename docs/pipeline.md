# Delivery milestones

This plan follows the assessment's five-step product contract while keeping the current task limited to the development and test harness. Each milestone should end with focused tests and a reviewable Git diff before the next one begins.

## Milestone 0 — Development harness (current)

- Establish TypeScript, React + Vite, Express, SQLite, and Vitest.
- Start both runtimes with `npm run dev`.
- Render a frontend placeholder and expose `GET /api/health`.
- Prove the setup with backend and frontend tests plus a production build.

Exit condition: the placeholder loads, the health endpoint returns JSON success, all current tests pass, and `npm run build` succeeds.

## Milestone 1 — Identity and project persistence

- Add name/email identity without passwords.
- Create, list, and reopen user-isolated projects.
- Accept pasted text or a validated `.txt` upload and store book text locally.
- Keep the complete text readable from project detail.

Test focus: validation, user isolation, empty/list states, filesystem persistence, and reopen behavior.

## Milestone 2 — Durable pipeline state

- Model five ordered steps independently from current run state.
- Add atomic database claims for attempts and conditional result writes.
- Represent running, failed, interrupted, and retryable states.
- Enforce the maximum of two adult characters and one chapter on the server.

Test focus: ordering, concurrent starts, stale recovery, retry preservation, and caps. No Gemini calls yet.

## Milestone 3 — Gemini text steps

- Add configurable current model IDs and the official integration boundary.
- Upload/send book content once and persist the reusable text interaction chain.
- Implement Style, Characters, and Chapters with structured validation.
- Persist every successful external identifier and result immediately.

Test focus: request construction, structured output validation, partial failure, and explicit retry. Automatic Gemini retries remain disabled.

## Milestone 4 — Portraits and illustration

- Generate portraits sequentially and persist each item as it completes.
- Continue the image conversation into the single chapter illustration.
- Decode, validate, and store images on the local filesystem behind application API routes.
- Surface queued, generating, completed, and failed item states in the UI.

Test focus: per-item progress, continuation after partial failure, MIME handling, local file serving, and attempt ownership.

## Milestone 5 — Final verification and polish

- Exercise refresh, restart, second-tab, failure, retry, and stale recovery paths manually.
- Complete responsive and keyboard-accessible UI states from the assessment.
- Run the full automated suite and record only real results in `TESTING.md`.
- Review environment documentation, decisions, AI artifacts, and Git history.
- Run a paid-key end-to-end check before claiming the real image pipeline works.

No public deployment, Docker setup, or bonus media features are planned within the required scope.
