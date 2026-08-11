# Gradion Book Illustrator

Local full-stack application for Gradion's book-illustration take-home assessment. The current milestone implements name/email identity, server-side sessions, user-isolated project persistence, pasted text and `.txt` uploads, and the initial project screens. The five-step Gemini illustration pipeline is intentionally not implemented yet.

## Prerequisites

- Node.js 24 or newer (the server uses Node's built-in SQLite module)
- npm 11 or newer

## Setup

```bash
npm install
cp .env.example .env
```

Copying `.env` is optional for the current defaults. On PowerShell, use `Copy-Item .env.example .env`.

Current environment variables:

- `PORT`: Express port; defaults to `3000`.
- `DATABASE_PATH`: local SQLite file; defaults to `./data/gradion.sqlite`.
- `UPLOADS_DIRECTORY`: local book/image root; defaults to `./uploads`.

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

- `src/client`: React Router screens for identity, project list, project creation, and project detail.
- `src/server`: Express API, SHA-256 hashed cookie sessions, SQLite repositories/migrations, and atomic local book storage.
- `src/shared`: Zod validation and DTO contracts shared by the browser and server.
- `data`: local SQLite runtime data, created automatically and ignored by Git.
- `uploads`: user/project-isolated book text, created automatically and ignored by Git.

The project uses one npm package and one `npm run dev` process supervisor to keep setup small. SQLite and local filesystem storage require no external service, so Docker would add setup overhead without solving a current dependency.

See [TESTING.md](TESTING.md), [DECISIONS.md](DECISIONS.md), and [docs/pipeline.md](docs/pipeline.md) for the test boundary, decisions, and future milestones.
