# Delivery milestones

This plan follows the assessment's five user-triggered product steps in their required order: Style → Characters → Portraits → Chapters → Illustrations. Each milestone must end with focused tests, a reviewable Git diff, and a small meaningful commit before the next milestone begins.

`DECISIONS.md` is updated incrementally. Before leaving any milestone, record only the meaningful decisions and genuine AI overrides that actually occurred; never reconstruct disagreements later. Keep the final log focused on roughly 4–6 strong decisions, including at least three real AI overrides by submission time.

## Milestone 0 — Development harness (completed)

- Establish TypeScript, React + Vite, Express, SQLite, and Vitest.
- Start both runtimes with `npm run dev`.
- Render a frontend placeholder and expose `GET /api/health`.
- Create and commit `AGENTS.md` with project context, conventions, and assessment constraints.
- Prove the setup with backend and frontend tests plus a production build.

Exit condition: the placeholder loads, the health endpoint returns JSON success, all current tests pass, and `npm run build` succeeds.

Decision checkpoint: record the source layout, SQLite storage choice, test harness, and development orchestration decisions that were genuinely made in this milestone.

## Milestone 1 — Identity and project persistence (completed)

Backend and storage:

- Add name/email identity without passwords and choose a lean session representation.
- Persist users and user-isolated projects in SQLite.
- Require a project title and validate it on the server.
- Accept pasted text or a validated `.txt` upload; store book text on the local filesystem.
- Create, list, reopen, and sign out without losing project state.
- Serve the complete stored book text through the application API.

Frontend:

- Build the Identity screen with name/email validation and sign out.
- Build the Project list with created date, Draft status, five-step progress indicator, and empty state.
- Build the New project form with required title, `.txt` upload, pasted-text alternative, and validation.
- Build the initial Project detail screen with title, created date, and complete readable book text.

Test focus: identity validation, project-title and text validation, user isolation, empty/list states, `.txt` handling, filesystem persistence, and reopening a project after restarting the server.

Exit condition: a user can sign in, create a titled project from paste or `.txt`, list it, reopen it, read the full text, sign out, and later resume the same data.

Decision checkpoint: update `DECISIONS.md` with any real choices about session representation, SQLite versus filesystem responsibilities, validation, or API shape before moving on.

## Milestone 2 — Durable pipeline state and recovery UI (completed)

Backend and storage:

- Model five ordered completed steps independently from the current run state.
- Add attempt identifiers, timestamps, and atomic database claims for step starts.
- Use conditional result writes so an old attempt cannot overwrite a newer attempt.
- Represent idle, running, failed, and interrupted/stale states without holding a transaction open during external work.
- Add explicit user-triggered retry and stale-run recovery paths.
- Enforce the maximum of two adult characters and one chapter on the server.

Frontend:

- Add the five-step stepper and project-level Draft / In progress / Done status.
- Add a named in-progress state, failed-step message with retry, and interrupted-step recovery affordance.
- Disable the current action while an attempt is already running.
- Build these views from real persisted project state; use component fixtures only in tests, not a fake production Gemini provider.

Test focus: out-of-order rejection, two concurrent starts producing one accepted attempt, conditional writes, retry preservation, stale recovery, server-side caps, and frontend running/error/interrupted states. No Gemini calls occur in this milestone.

Exit condition: pipeline state survives refresh and restart, duplicate starts are rejected atomically, and every failed or stale state has an explicit safe recovery action.

Decision checkpoint: record the actual progress model, duplicate-execution strategy, stale threshold/recovery design, and any genuine AI proposal that was rejected or simplified.

## Milestone 3 — Style and Characters (steps 1–2; implemented, real-key smoke pending)

Integration:

- Reconfirm current model IDs, endpoint or official SDK behavior, structured output mechanics, and interaction chaining against the notebook and current official documentation.
- Upload/send the book content once, create the reusable text interaction, and persist its external identifiers immediately.
- Implement Style with both supported paths: an optional user-supplied style or a Gemini-generated style when left blank.
- Implement the structured adult-character list and prompts with a server-enforced maximum of two.
- Persist each successful interaction ID and validated result before any later call starts.
- Keep automatic Gemini retries disabled; failures are retried only by explicit user action.

Frontend:

- Add the optional style input and current-step action.
- Display the completed style in project detail.
- Display character cards with names and generated text prompts; portraits remain visibly not generated.

Test focus: both style paths, request construction, text interaction reuse, structured output validation, adult-character cap, persistence after partial failure, explicit retry, and Style/Character UI states.

Exit condition: steps 1 and 2 run only in order, survive refresh/restart, expose no duplicate calls, and render their persisted outputs.

Decision checkpoint: record the real REST-versus-SDK/model choice, structured validation approach, and any genuine AI override. Do not claim image mechanics were verified here.

Implementation note: the official `@google/genai` gateway, stored interaction chain, intermediate SQLite persistence, explicit rehydration, Style/Character UI, polling, and fake-gateway automated coverage are complete. A real-key smoke call remains deliberately pending explicit project-owner approval; M3 should be marked fully completed only after that result is recorded honestly.

## Milestone 4 — Portraits (step 3; implemented, real-key smoke pending)

Integration:

- Establish image context with the first actual portrait request using the persisted style and negative rules; do not spend a separate image call on a seed-only interaction.
- Generate at most two adult-character portraits sequentially, chaining each portrait from the previous image interaction as required by the notebook.
- Validate response blocks and MIME types, decode image data safely, and write each completed portrait to the local filesystem immediately.
- Persist per-item queued, generating, completed, and failed state so retry resumes only missing work.
- Serve stored portraits through application API routes.

Frontend:

- Add portrait areas to character cards.
- Show per-character queued, generating, completed, and failed progress as each portrait lands.
- Keep completed portraits visible when a later portrait fails or is retried.

Test focus: sequential chaining, response/MIME validation, safe local writes, per-item persistence, continuation after partial failure, local file serving, attempt ownership, and portrait progress UI.

Exit condition: step 3 cannot run before Characters, generates no more than two portraits, preserves each successful image, and supports retrying only missing work.

Decision checkpoint: record the image decoding/storage design and any real simplification or correction of AI output. Do not claim a real image response passed unless a paid-key run actually succeeded.

Implementation note: per-character SQLite state, sequential stored-interaction chaining, local-reference rebuilding, validated atomic image storage, authenticated image serving, Portrait UI states, and fake-gateway automated coverage are complete. A real-key paid image call remains deliberately pending and is not claimed as passed.

## Milestone 5 — Chapters and Illustrations (steps 4–5; implemented, real-key smoke pending)

Integration:

- Keep Chapters server-locked until Portraits completes, even though its prompt resumes the stored text chain from Characters.
- Generate and validate a structured chapter illustration prompt with a server-enforced maximum of one chapter.
- Persist the chapter interaction ID and prompt immediately.
- Transition the stored portrait image conversation into the chapter scene and generate one illustration with character consistency.
- Validate, decode, persist, and serve the illustration using the same safe image-storage boundary.
- Preserve all text and portraits if either step fails; retry only the failed current step or missing item.

Frontend:

- Add the chapter card with name and generated prompt after step 4.
- Add queued, generating, completed, and failed illustration progress after step 5 starts.
- Show the final illustration while keeping the full book text, style, character prompts, portraits, and chapter prompt accessible.

Test focus: Portraits-before-Chapters ordering, one-chapter cap, text-chain resumption, image-chain continuation, partial failure preservation, explicit retry, local image serving, and chapter/illustration UI states.

Exit condition: steps 4 and 5 run only after their required predecessors, persist their outputs, preserve character consistency context, and complete the five-step project without automatic retries.

Decision checkpoint: record the verified two-chain mechanics and any genuine AI override. Clearly separate notebook-observed text behavior from image behavior that still lacks a successful paid-key end-to-end run.

Implementation note: the exact-one Chapter schema, text-chain continuation and recovery, one-call image-chain transition, local portrait-reference rebuilding, atomic Illustration storage, authenticated serving, final UI states, and fake-gateway automated coverage are implemented. The current GA image ID was rechecked against Google's model lifecycle documentation after the notebook's preview ID proved stale. No paid-key image result is claimed yet.

## Milestone 6 — Final verification and polish

- Exercise refresh, logout, server restart, second tab, double-click, partial item failure, retry, and stale recovery manually.
- Polish responsive layouts, keyboard navigation, focus behavior, loading transitions, validation feedback, and layout stability; do not defer first implementation of any required screen to this milestone.
- Run the complete frontend/backend suite and record only the final real output in `TESTING.md`.
- Review `README.md`, environment variables, `AGENTS.md`, `DECISIONS.md`, AI artifacts, and Git history.
- State explicitly in `README.md` that Docker is skipped because SQLite and local filesystem storage require no external service and Docker would add setup overhead.
- Curate `DECISIONS.md` to the strongest genuine decisions without inventing pushback; include the required one-more-day answer.
- Run a paid-key end-to-end image check before claiming the complete real image pipeline works.

Exit condition: all required automated and manual checks have real recorded evidence, documentation matches the implementation, and no unsupported success claim remains.

Decision checkpoint: add only final decisions that actually arise during verification; do not backfill missing AI overrides.

No public deployment, Docker setup, automatic Gemini retry loop, or bonus media features are planned within the required scope.
