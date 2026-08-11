# Decisions

This log contains only choices that were actually made while building the application. It is intentionally curated to remain a decision record, not a milestone diary.

## One local TypeScript stack with SQLite and filesystem storage

The initial AI analysis recommended TypeScript throughout, React + Vite, Express, SQLite, and one npm package. I accepted that direction because a single language and dependency manifest keep a time-boxed local assessment easy to run. SQLite owns relational and pipeline state, while book text and later image bytes belong on the filesystem; Node's built-in `node:sqlite` avoids a native package. The accepted costs are Node 24 or newer, explicit migrations, and a clear client/server boundary enforced by separate TypeScript configurations rather than separate packages.

## Opaque database sessions instead of JWT

Codex proposed a random opaque session token in an HTTP-only cookie rather than trusting an email header or adding JWT signing-key management. I accepted it and required the security details to be explicit: only a SHA-256 token hash is stored, sessions expire after seven days, and the cookie is `Secure` in production but remains usable over local HTTP in development. `SameSite=Lax`, same-origin JSON APIs, and no cross-origin CORS cover the current CSRF boundary, so a separate CSRF-token system would not match this application's risk. The cost is a database lookup per authenticated request and eventual session cleanup.

## File first, visible project second — user override

Codex proposed one multipart endpoint with in-memory validation but initially left the SQLite/file ordering undefined. I pushed back because inserting the row first could expose a project whose book failed to persist. The implementation validates exactly one source, decodes uploaded `.txt` data as non-empty UTF-8, writes a temporary file and atomically renames it, then inserts the row; a failed insert triggers best-effort cleanup. A crash can still leave an invisible orphan file, but it cannot leave a visible project pointing at missing text.

## Attempt-owned pipeline state and exact recovery — user override

Codex proposed separating completed progress from the current run, and I accepted it after requiring the transitions and race behavior to be explicit. A claim atomically checks ownership, order, and state, creates a new attempt UUID, and clears old errors. Every intermediate and final write checks the matching running attempt, so an old worker cannot overwrite a retry. A duplicate start returns `200` with `claimed: false` and the current state because a second tab is normal idempotent behavior, not an application error.

I also tightened the proposed stale recovery: the update itself must re-check `attempt_id`, the observed `started_at`, the running state, ownership, and the cutoff. It cannot trust a previous GET. Completion winning that race therefore makes Recover a no-op. Failed and interrupted attempts retain their identifier for diagnosis; retry creates a new one and clears the error.

## Official Gemini SDK, Standard tier, and zero automatic retries — AI correction

For M3 I chose the official `@google/genai` SDK behind a small `GeminiGateway`, a configurable current text model (`gemini-3.6-flash` by default), stored Interactions, and Standard service tier. The gateway makes prompts and structured response settings reviewable while tests substitute a fake only at this boundary. The server validates the structured character result again and accepts zero to two adults; a model schema alone is not treated as a trustworthy cap.

The notebook and SDK defaults retry requests automatically, which conflicts with the assessment's cost rule. Codex initially set the Files API's `retryOptions.attempts` to `1`, incorrectly treating it as one total attempt. Reading the installed SDK showed that value maps directly to `maxRetries`, so it still meant one retry. I corrected both SDK paths to `0`. A failure is persisted and only a new user action can issue another Gemini request.

## Persist interaction boundaries and rebuild expired context

M3 runs each claimed step in an in-process background task and the browser polls persisted project state. This is deliberately smaller than a durable job queue; if the process dies, the existing stale-attempt recovery makes the interruption visible and retryable. File references, interaction IDs, style input, validated output, and character rows are saved at each successful boundary, so retry resumes after the last durable call rather than resending completed work.

Gemini-hosted files and stored interactions are not permanent. The local book remains the source of truth. When Gemini reports the stored chain as expired, the server marks that context expired and fails the current attempt. On an explicit retry it uploads the local book again, recreates the book interaction, and, when necessary, replays the already-persisted style into the new chain without regenerating or replacing the user's completed Style result. This adds rehydration logic but avoids pretending remote identifiers are durable application state.

## If I had one more day

I would finish the image steps and spend the remaining time on a paid-key end-to-end run with deliberate mid-step failures, because image response handling and cross-restart resume behavior carry the largest remaining correctness and cost risk.
