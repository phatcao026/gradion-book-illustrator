# Decisions

This log contains only choices made while building the initial development and test harness. It does not claim any human override or disagreement that did not happen.

## Keep one npm package with source separated by runtime

Codex selected a single package with `src/client`, `src/server`, and a reserved `src/shared` directory. Separate packages or a workspace would add dependency and script coordination without helping this scaffold. The accepted cost is that frontend and backend dependencies share one manifest; the source and TypeScript configurations still keep their runtime boundaries explicit.

## Use Node's built-in SQLite module

The handoff states that Node 24 is available, so the scaffold uses `node:sqlite` instead of adding a native SQLite package. This gives the backend a real local database and an in-memory test database with no native compilation step. The trade-off is an explicit Node 24 minimum rather than compatibility with older LTS releases.

## Test the Express app through HTTP with injected storage

The Express application is created by a small factory that receives a database connection. The health test can therefore exercise the real route with Supertest and an in-memory SQLite instance, without binding a port or touching runtime files. This small injection seam is kept because it makes the first backend test deterministic and will support later service tests; no wider repository abstraction is introduced yet.

## Use Vite's development proxy and one process supervisor

`npm run dev` starts Vite and Express together with `concurrently`, while Vite proxies `/api` to the backend. This keeps browser requests same-origin in development and satisfies the one-command requirement. It adds one development-only dependency, but avoids a custom launcher and premature deployment configuration.

## Keep this milestone free of Gemini substitutes

The current task explicitly excludes Gemini integration and a mock Gemini provider. The scaffold therefore stops at health/readiness behavior instead of inventing interfaces for an API flow that is not being implemented or tested yet. Provider boundaries will be decided when the pipeline milestone begins and can be informed by real call mechanics.

## Next update

Add entries only when a real implementation choice or genuine AI override occurs. Before final submission, answer the assessment's “one more day” question based on the state of the completed application rather than predicting it during scaffolding.
