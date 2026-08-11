# Gradion Book Illustrator

Local full-stack application for Gradion's book-illustration take-home assessment. The complete five-step pipeline is implemented: Style, adult Characters, Portraits, one Chapter prompt, and one final Illustration. Automated coverage, local browser verification, and a separately labeled owner-performed real-key five-step acceptance are complete.

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

- `src/client`: React Router screens, 1.5-second polling while a step runs, every persisted result, per-image progress, and running/error/recovery views.
- `src/server`: Express API, SHA-256 hashed cookie sessions, SQLite migrations, atomic local book/image storage, conditional pipeline writes, and official Gemini SDK text/image gateways.
- `src/shared`: validation and DTO contracts shared by the browser and server.
- `docs/ai/prompts.md`: the Gemini prompts and execution settings actually used across all five steps.
- `data`: local SQLite runtime data, created automatically and ignored by Git.
- `uploads`: user/project-isolated book text, created automatically and ignored by Git.

The project uses one npm package and one `npm run dev` process supervisor to keep setup small. SQLite and local filesystem storage require no external service, so Docker would add setup overhead without solving a current dependency.

The pipeline uses stored Gemini Interactions and persists each reusable identifier or validated output before the next external call. Portraits are generated sequentially; the Chapter prompt resumes the text chain from Characters; and the final 16:9 Illustration resumes the portrait chain or rebuilds from completed local portraits. Images are written immediately and retries skip completed work. The SDK is configured with zero automatic retries; only Generate/Retry buttons can issue a new attempt. Automated tests use fakes only at gateway boundaries; real-key acceptance is recorded separately as an owner-performed UI check.

GitHub Actions is configured to run `npm ci`, `npm test`, and `npm run build` on Node.js 24 for pushes to `main` and pull requests. The workflow receives no Gemini secrets and makes no paid API calls.

## Verification boundary

The isolated final local pass covers the full automated suite, production build, health endpoint, validation, refresh, server restart, two-tab behavior, duplicate clicks, explicit retry, stale recovery, logout, keyboard affordances, and desktop layout without a Gemini key. On 2026-08-12 the project owner separately completed all five steps through the real UI with a billed Gemini project after the upload and image-format corrections. Model-level visual consistency was not independently scored. See `TESTING.md` for the exact evidence boundaries.

See [TESTING.md](TESTING.md), [DECISIONS.md](DECISIONS.md), and [docs/pipeline.md](docs/pipeline.md) for the test boundary, decisions, and future milestones.
