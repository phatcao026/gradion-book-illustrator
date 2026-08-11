# Testing

## Strategy

Vitest is the single test runner for both sides of the application. The backend test uses an in-memory SQLite database and Supertest against the real Express application, so it verifies the HTTP status, JSON body, and database-backed health check without opening a network port. The frontend test uses React Testing Library with jsdom to verify that the placeholder page renders its primary heading and readiness message.

This milestone deliberately does not test identity, project persistence, upload validation, pipeline ordering, retry behavior, concurrency claims, or Gemini interactions because none of those features exists yet. Those tests belong to the milestones described in `docs/pipeline.md`; adding mocks now would imply unsupported behavior.

## Commands

```bash
npm test
npm run build
```

## Actual run

Environment: Windows, Node `v24.15.0`, npm `11.12.1`. Run on 2026-08-10.

`npm.cmd test`:

```text
> gradion-book-illustrator@0.1.0 test
> vitest run

 RUN  v4.1.10 D:/Gradion/gradion-book-illustrator

 Test Files  2 passed (2)
      Tests  2 passed (2)
   Start at  23:55:34
   Duration  1.17s (transform 71ms, setup 237ms, import 236ms, tests 106ms, environment 818ms)
```

`npm.cmd run build` (final run):

```text
> gradion-book-illustrator@0.1.0 build
> npm run typecheck:client && npm run build:client && npm run build:server

> gradion-book-illustrator@0.1.0 typecheck:client
> tsc -p tsconfig.client.json --noEmit

> gradion-book-illustrator@0.1.0 build:client
> vite build

vite v8.2.1 building client environment for production...
✓ 16 modules transformed.
dist/client/index.html                   0.48 kB │ gzip:  0.29 kB
dist/client/assets/index-XguvAiAD.css    1.13 kB │ gzip:  0.62 kB
dist/client/assets/index-rydT8t0o.js   190.96 kB │ gzip: 60.19 kB
✓ built in 107ms

> gradion-book-illustrator@0.1.0 build:server
> tsc -p tsconfig.server.json
```

The first build attempt failed at client type-checking because the CSS side-effect import had no Vite type declaration:

```text
src/client/main.tsx(5,8): error TS2882: Cannot find module or type declarations for side-effect import of './styles.css'.
```

Adding `src/client/vite-env.d.ts` fixed that configuration gap; the final build above then completed with exit code 0.

Manual smoke check while `npm.cmd run dev` was running:

```text
HEALTH_STATUS    200
HEALTH_BODY      {"status":"ok"}
PROXY_STATUS     200
PROXY_BODY       {"status":"ok"}
FRONTEND_STATUS  200
FRONTEND_HAS_ROOT True
```

## Milestone 1 coverage

Backend integration tests now exercise the real Express application with temporary on-disk SQLite and upload directories. They cover identity validation, normalized email, SHA-256 session-token storage, development/production cookie flags, sign out, pasted-text persistence, UTF-8 `.txt` validation, exactly-one-source enforcement, user isolation, and reopening the same session/project after closing and reopening SQLite. Supertest sends real JSON, multipart, and cookie-bearing HTTP requests without binding an external port.

Frontend tests cover the signed-out Identity screen, client-side identity validation, signed-in project empty state, new-project title/source validation, and full book text on Project detail. Component tests use API response fixtures only at the browser boundary; there is no Gemini provider or fake production pipeline state.

Deliberately excluded at this milestone: pipeline ordering, duplicate attempt claims, stale recovery, Gemini requests, image handling, and generated item states. Those behaviors do not exist until Milestones 2–5 and are not claimed as tested.

## Milestone 1 actual run

Final `npm.cmd test` output on 2026-08-11:

```text
> gradion-book-illustrator@0.1.0 test
> vitest run

 RUN  v4.1.10 D:/Gradion/gradion-book-illustrator

 Test Files  3 passed (3)
      Tests  11 passed (11)
   Start at  12:56:14
   Duration  2.73s (transform 267ms, setup 905ms, import 1.27s, tests 1.04s, environment 1.94s)
```

Final `npm.cmd run build` output:

```text
> gradion-book-illustrator@0.1.0 build
> npm run typecheck:client && npm run build:client && npm run build:server

> gradion-book-illustrator@0.1.0 typecheck:client
> tsc -p tsconfig.client.json --noEmit

> gradion-book-illustrator@0.1.0 build:client
> vite build

vite v8.2.1 building client environment for production...
✓ 110 modules transformed.
dist/client/index.html                   0.48 kB │ gzip:  0.30 kB
dist/client/assets/index-tpepAzFB.css    8.21 kB │ gzip:  2.57 kB
dist/client/assets/index-BvJIcf1S.js   298.92 kB │ gzip: 92.09 kB
✓ built in 421ms

> gradion-book-illustrator@0.1.0 build:server
> tsc -p tsconfig.server.json
```

Browser smoke check through `http://localhost:5173`:

```text
Identity screen rendered
Sign in succeeded through Vite /api proxy
Empty project state rendered
Pasted-text project creation succeeded
Project detail rendered all five step labels and the complete stored text
Reload preserved the signed-in session and project list
Sign out returned to Identity
Signing in with the same email reopened the existing project
Browser console errors: 0
```

## Milestone 1 manual UI acceptance

Performed by the project owner on 2026-08-11 against the local development stack. All scenarios below were reported as passing with the expected behavior:

1. Identity validation rejected empty, too-short name, and invalid email input; valid name/email continued to the project list.
2. A pasted-text project was created, displayed as Draft with five pipeline steps, preserved line breaks, and appeared in the project list at 0/5 progress.
3. A valid UTF-8 `.txt` upload created a project and displayed the complete uploaded text.
4. Supplying both file and pasted text, or supplying neither, was rejected by the exactly-one-source validation.
5. A non-`.txt` file and a deliberately invalid UTF-8 `.txt` file were rejected without creating a project.
6. Browser refresh and a full local server stop/start preserved the session, project list, and stored book text without creating duplicates.
7. Sign out returned to Identity; signing in with the original email reopened its projects, while a second email saw an isolated empty project list.

This section records user-performed acceptance testing; it is not presented as automated coverage.
