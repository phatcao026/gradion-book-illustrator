# Gradion Assessment — Project Handoff

## Purpose

This file transfers the useful context from the initial assessment-analysis chat into the local coding project. It intentionally contains no API keys, Gemini file URIs, interaction IDs, or other secrets.

## Current status

- Assessment received on 2026-08-10; safest deadline assumption is 2026-08-13 at approximately the receipt time.
- The assessment brief and `app-demo.html` have been read and analyzed.
- The required Google Book Illustration notebook was explored manually in Colab.
- Book upload, initial interaction, style generation, structured character prompts, and structured chapter prompts were successfully exercised.
- Image generation was not executed successfully because the API project has free-tier quota `0` for `gemini-3.1-flash-lite-image`.
- Current official Gemini pricing shows no free tier for the relevant image-generation models. A paid Gemini API project is required for final real-image verification.
- No application repository or implementation has been created yet.

## Source material

Copy these supplied files into the new repository as references:

- `gradion-assessment-intern-software-engineer.md`
- `app-demo.html`

Suggested destinations:

```text
docs/reference/assessment.md
docs/reference/app-demo.html
```

Do not copy the recruiter email or any personal information into the repository.

## Product contract

Build a local full-stack web app that turns book text into illustrations through five user-triggered steps:

1. Style: use an optional user style or ask Gemini to generate one.
2. Characters: structured list of adult characters with prompts; maximum 2.
3. Portraits: one image per character.
4. Chapters: structured chapter illustration prompt; maximum 1.
5. Illustrations: one chapter image that reuses the portrait image conversation for character consistency.

Other required behavior:

- Identity is name + email, without password or OAuth.
- A user has many isolated projects.
- Project creation supports pasted text and `.txt` upload.
- Steps run only in order and only after explicit user actions.
- State and completed outputs survive refresh, sign-out, and server restart.
- Double-click, refresh, and a second tab must not trigger duplicate Gemini calls.
- Running UI names the active step.
- Failed steps are explicitly retryable without losing completed work.
- Interrupted/stale work has a user-triggered recovery path.
- No automatic Gemini retry loop.
- Book content is sent to Gemini once and reused through stored interaction chaining.
- Character/chapter caps are enforced server-side, not only in the UI.
- Images and book text live on the local filesystem and are served through the application's API.
- Do not deploy publicly.

## Reference notebook mechanics learned

### Text chain

```text
Upload book with Files API
  -> create book interaction with document URI
  -> style interaction using previous_interaction_id
  -> character prompt interaction using structured JSON output
  -> chapter prompt interaction chained from the character prompt interaction
```

### Image chain

```text
Create separate image-context interaction with style and negative rules
  -> portrait 1
  -> portrait 2, chained from portrait 1
  -> transition image conversation to chapter illustration
  -> chapter illustration, chained from the portrait conversation
```

Important implementation detail: persist every successful file URI, interaction ID, item result, and image immediately. If a later sub-call fails, retry only the missing work.

### Manual verification boundary

Verified:

- Files API upload.
- Initial stored interaction.
- `previous_interaction_id` text chaining.
- Generated/user-provided style flow.
- Structured JSON character prompts.
- Structured JSON chapter prompts.

Not yet verified with a real API response:

- Image response block extraction.
- Base64 decoding and MIME handling.
- Local image writes.
- Sequential portrait image chaining.
- Final chapter image chaining from portraits.

Do not claim the complete image pipeline passed until a paid-key end-to-end run succeeds.

## Gemini billing finding

- A Gemini/Google AI Pro consumer subscription does not grant paid Gemini Developer API quota.
- API keys inherit quota and billing from their Google Cloud project.
- Relevant image models currently require paid API billing.
- `gemini-3.1-flash-lite-image` is the preferred low-cost real-image candidate unless current official docs change before implementation.
- Keep model IDs configurable through environment variables.
- Use standard service tier, not priority.
- The notebook configures multiple automatic retries, but the assessment explicitly prohibits automatic Gemini retry loops. The app must override that behavior and expose only user-triggered retry.

## Recommended lean stack

- TypeScript throughout.
- React + Vite frontend.
- Express backend.
- SQLite with short atomic transactions.
- Local filesystem for book text and images.
- Official `@google/genai` JavaScript/TypeScript SDK.
- Zod for requests and Gemini structured output.
- Vitest for tests.
- React Testing Library for frontend component states.
- Supertest for backend endpoints.
- Poll project state every 1–2 seconds; do not add SSE/WebSocket unless all required work is complete.
- No Docker unless a real need appears.

The machine already has Git, Node.js 24 LTS, and npm. GitHub CLI is absent but optional.

## Suggested repository structure

```text
gradion-book-illustrator/
├── AGENTS.md
├── README.md
├── DECISIONS.md
├── TESTING.md
├── .env.example
├── .gitignore
├── package.json
├── docs/
│   ├── plan.md
│   ├── architecture.md
│   ├── pipeline.md
│   ├── ai/
│   │   └── prompts.md
│   └── reference/
│       ├── assessment.md
│       └── app-demo.html
├── src/
│   ├── client/
│   ├── server/
│   └── shared/
├── data/
├── uploads/
└── tests/
```

Ignore `.env`, runtime database files, uploaded books, and generated images. Commit `.env.example` only.

## State-model direction

A right-sized project state can separate completed progress from current execution:

```text
completedStep: 0..5
activeStep: null | 1..5
runState: IDLE | RUNNING | FAILED | INTERRUPTED
attemptId
startedAt
error
textInteractionId
imageInteractionId
```

Characters and chapters need per-item states such as:

```text
QUEUED | GENERATING | COMPLETED | FAILED
```

Duplicate prevention must be an atomic database claim, not a disabled frontend button or an in-memory boolean. Do not hold a database transaction open during a long Gemini request. Conditional result writes should include the active attempt ID so an old worker cannot overwrite a newer attempt.

## Important findings from the supplied demo

The demo is a reference, not production code. Do not port its localStorage database, timers, or duplicate guard.

Improve these areas:

- It has no real error state.
- Duplicate prevention exists only in one browser tab.
- Its 8-second stale threshold is unrealistic.
- Its Retry button only resets state rather than performing a clear retry flow.
- It does not perform strong email/file validation.
- After style generation it hides access to the full book text, conflicting with the requirement that the book remain readable at every point.
- Per-item UI should distinguish queued, generating, complete, and failed rather than marking every unfinished image as generating.

## Testing priorities

Backend:

- Reject out-of-order steps.
- Two concurrent start requests result in one Gemini call.
- Failed step becomes retryable.
- Retry preserves completed steps and completed image items.
- Stale running state can be recovered through an explicit user action.
- Server-side maximums remain 2 characters and 1 chapter.
- User A cannot read User B's project.

Frontend:

- Empty project list.
- Named loading state.
- Error and retry state.
- Interrupted recovery state.
- Progressive per-item image state.
- Action button disabled while an existing attempt runs.

Nice to have only after required work: one mocked happy-path integration test through all five steps.

## Required assessment evidence

- `README.md`: prerequisites, environment variables, architecture, one start command, one test command.
- `DECISIONS.md`: 4–6 genuine decisions, including at least 3 real AI overrides; do not backfill fictional disagreements.
- `TESTING.md`: frontend/backend strategy, deliberate exclusions, and output from a real test run.
- AI artifacts: `AGENTS.md`, generated plan/architecture notes, and saved prompts that were genuinely used.
- Small incremental Git commits with meaningful messages and honest AI authorship notes when applicable.
- `.env.example` with no secrets.

Potential genuine decision to record when implemented: the notebook uses multiple automatic retries, while the assessment's cost rule requires disabling them and making retries user-triggered.

## Immediate next milestone

Time-box setup to roughly 60–90 minutes. The first milestone is only:

```text
npm run dev
  -> frontend placeholder loads
  -> GET /api/health returns OK

npm test
  -> at least one real test passes
```

Then implement the first vertical slice:

```text
Sign in -> create project -> list projects -> reopen project
```

Do not integrate real Gemini until the basic project flow and test harness work.

## Suggested first prompt in the new project chat

```text
Read PROJECT_HANDOFF.md and the two files under docs/reference completely before acting.

We are starting the Gradion take-home assessment from an empty repository. First, verify the local environment and propose a minimal TypeScript repository structure using React + Vite, Express, SQLite, and Vitest. Then scaffold only the development/test harness so that one command starts the frontend and backend, one command runs tests, the frontend shows a placeholder, and GET /api/health returns OK.

Also create a concise AGENTS.md and docs/plan.md based on the assessment. Do not integrate Gemini, implement application features, add Docker, or create fictional DECISIONS.md entries yet. Explain the important generated files, run the tests, and show me the resulting Git diff before suggesting the first commit.
```

## Official references

- Gemini Book Illustration notebook: https://github.com/google-gemini/cookbook/blob/main/examples/Book_illustration.ipynb
- Gemini API documentation: https://ai.google.dev/gemini-api/docs
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini billing: https://ai.google.dev/gemini-api/docs/billing
- Codex Projects and Chats: https://learn.chatgpt.com/docs/projects
