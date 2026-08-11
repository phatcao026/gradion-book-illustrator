# Decisions

This log contains only choices that were actually made while building the application. It is kept incrementally and does not invent disagreement or AI overrides after the fact.

## TypeScript full stack in one npm package

The initial AI analysis recommended TypeScript throughout, with React and Vite for the frontend and Express for the backend. I accepted that direction because one language across both runtimes and Vite's short feedback loop fit a time-boxed assessment. Codex kept the client and server in one npm package and used Vite's `/api` proxy instead of introducing a workspace or custom launcher. The cost is a shared dependency manifest, while separate source trees and TypeScript configurations must continue to enforce the runtime boundary.

## SQLite instead of JSON files for durable state

The assessment permits JSON files, but the AI handoff recommended SQLite and I accepted it because later milestones require atomic duplicate-execution claims, user isolation, conditional writes, and durable recovery. Implementing those guarantees on JSON would mean designing custom locking and concurrent-write behavior. We use Node's built-in `node:sqlite` module to avoid a native dependency. The accepted cost is requiring Node 24 or newer and maintaining explicit schema migrations.

## Opaque database sessions instead of JWT

Codex proposed a random opaque session token in an HTTP-only cookie rather than trusting an email header or adding JWT signing-key management. I accepted the approach and required the implementation details to be explicit: only a SHA-256 token hash is stored in SQLite, sessions expire after seven days, and the cookie is `Secure` in production while remaining usable over local HTTP in development. `SameSite=Lax`, same-origin APIs, and no cross-origin CORS cover the current CSRF boundary, so an additional CSRF-token system would add complexity without a matching risk in this local application. The cost is one database lookup per authenticated request and server-side session cleanup over time.

## File first, visible project second

Codex initially proposed a single multipart project endpoint with in-memory upload validation, but left the ordering between the filesystem write and SQLite insert undefined. I pushed back because inserting the row first could expose a project whose book file failed to write. We now validate exactly one source, decode uploaded `.txt` data as non-empty UTF-8, write a temporary file and atomically rename it, then insert the project row; a failed insert triggers best-effort file cleanup. This favors database integrity. The remaining crash window can leave an invisible orphan file, but never a visible project that points to missing text.

## Separate completed progress from the current attempt

Codex proposed storing completed progress separately from the current run, and I accepted it after requiring a transition table before implementation. Each claim atomically checks the ordered step and observed state, creates a new UUID attempt, and clears old errors. Completion and failure apply only to the matching running attempt, so an old worker cannot overwrite a retry. Failed and interrupted attempts retain their identifiers for debugging, while a retry replaces the identifier and clears errors. Duplicate claims are normal idempotent responses (`claimed: false`), not conflicts; only invalid ordering is a conflict. This adds state fields and conditional SQL, but makes refresh, duplicate tabs, retries, and partial failure deterministic.

## User-triggered stale recovery without a fake runner

I required stale recovery to re-check the exact `attempt_id`, observed `started_at`, running state, ownership, and cutoff in the update itself rather than trust an earlier GET. A completion that wins the race therefore makes Recover a no-op. The threshold defaults to ten minutes and is configurable. We also explicitly chose not to add a fake pipeline provider in M2, keeping the service pure and using component fixtures only in tests: a production start endpoint that performs no real work would leave projects falsely running and would be discarded in M3. The tradeoff is that generate/retry actions remain visibly disabled until real Gemini execution is added; stale recovery is the only live M2 pipeline action.
