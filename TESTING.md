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
