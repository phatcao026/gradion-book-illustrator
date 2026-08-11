# Gradion Book Illustrator

Local full-stack application for Gradion's book-illustration take-home assessment. The current milestone implements identity, user-isolated project persistence, durable pipeline recovery, and the Gemini-backed Style, adult-Character, and Portrait steps. Chapter and final-illustration generation remain intentionally unavailable.

## Prerequisites

- Node.js 24 or newer (the server uses Node's built-in SQLite module)
- npm 11 or newer

## Setup

```bash
npm install
cp .env.example .env
```

On PowerShell, use `Copy-Item .env.example .env`. The app and health endpoint run without a Gemini key, but starting Style will persist a clear configuration failure until `GEMINI_API_KEY` is set.

Current environment variables:

- `PORT`: Express port; defaults to `3000`.
- `DATABASE_PATH`: local SQLite file; defaults to `./data/gradion.sqlite`.
- `UPLOADS_DIRECTORY`: local book/image root; defaults to `./uploads`.
- `STALE_ATTEMPT_MINUTES`: age at which a running attempt can be manually recovered; defaults to `10`.
- `GEMINI_API_KEY`: Gemini Developer API key; no default and never committed.
- `GEMINI_TEXT_MODEL`: current text model; defaults to `gemini-3.6-flash`.
- `GEMINI_IMAGE_MODEL`: current portrait model; defaults to `gemini-3.1-flash-image`.
- `GEMINI_SERVICE_TIER`: fixed to `standard`; another value is rejected at startup.

Session cookies are marked `Secure` automatically when `NODE_ENV=production`; local HTTP development keeps that flag disabled.

## Commands

```bash
# Start Vite and Express together
npm run dev

# Run all frontend and backend tests once
npm test

# Type-check and build the frontend and backend
npm run build
```

During development, open `http://localhost:5173`. The backend listens on `http://localhost:3000`, and Vite proxies `/api` requests to it. The health endpoint is `GET /api/health`.

## Current architecture

- `src/client`: React Router screens, 1.5-second polling while a step runs, Style/Character results, per-character Portrait progress, and persisted running/error/recovery views.
- `src/server`: Express API, SHA-256 hashed cookie sessions, SQLite migrations, atomic local book/image storage, conditional pipeline writes, and official Gemini SDK text/image gateways.
- `src/shared`: validation and DTO contracts shared by the browser and server.
- `docs/ai/prompts.md`: the Gemini prompts and execution settings actually used through M4.
- `data`: local SQLite runtime data, created automatically and ignored by Git.
- `uploads`: user/project-isolated book text, created automatically and ignored by Git.

The project uses one npm package and one `npm run dev` process supervisor to keep setup small. SQLite and local filesystem storage require no external service, so Docker would add setup overhead without solving a current dependency.

M3–M4 use stored Gemini Interactions and persist each reusable identifier or validated output before the next external call. Portraits are generated sequentially, written to local storage immediately, and retries skip completed characters. The SDK is configured with zero automatic retries; only the Generate/Retry buttons can issue a new attempt. Automated tests use fakes only at the gateway boundaries and do not claim that a real API call passed.

See [TESTING.md](TESTING.md), [DECISIONS.md](DECISIONS.md), and [docs/pipeline.md](docs/pipeline.md) for the test boundary, decisions, and future milestones.
