# Gradion Book Illustrator

Minimal development and test harness for Gradion's book-illustration take-home assessment. This milestone proves that the React frontend, Express backend, local SQLite database, and Vitest test harness work together. It intentionally does not implement identity, projects, uploads, the illustration pipeline, or Gemini.

## Prerequisites

- Node.js 24 or newer (the server uses Node's built-in SQLite module)
- npm 11 or newer

## Setup

```bash
npm install
cp .env.example .env
```

Copying `.env` is optional for the current defaults. On PowerShell, use `Copy-Item .env.example .env`.

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

- `src/client`: React placeholder application and its render test.
- `src/server`: Express application, SQLite bootstrap, runtime entry point, and HTTP integration test.
- `src/shared`: reserved for contracts that are genuinely shared by both sides; it is intentionally empty in this milestone.
- `data`: local SQLite runtime data (created automatically and ignored by Git).
- `uploads`: future local book/image storage (ignored by Git).

The project uses one npm package and one `npm run dev` process supervisor to keep the initial setup small. Docker is not needed for this local-only stack.

See [TESTING.md](TESTING.md), [DECISIONS.md](DECISIONS.md), and [docs/pipeline.md](docs/pipeline.md) for the test boundary, decisions, and future milestones.
