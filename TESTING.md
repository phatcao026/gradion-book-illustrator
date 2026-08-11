# Testing

## Strategy

Vitest is the single test runner for both sides of the application. Backend integration tests use temporary on-disk SQLite databases and upload directories with Supertest against the real Express application. Frontend tests use React Testing Library with jsdom. Pipeline state tests inject only clocks and attempt IDs; they do not fake Gemini or expose a production runner.

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

## Milestone 2 coverage

Backend tests cover ordered claims, one winner across two SQLite connections, an idempotent duplicate loser, failure context, error clearing and a new attempt ID on retry, conditional completion that rejects an old worker, exact stale-attempt recovery, a completion-versus-recovery race, pipeline state after reopening SQLite, derived project statuses, authenticated recovery API checks, and the declared server-owned character/chapter caps. Existing identity, project, upload, isolation, restart, and health tests remain in the full suite.

Frontend tests cover persisted running, failed, stale, and interrupted views. They verify that a running action and pre-M3 retry actions remain disabled and that only a stale running state exposes the Recover callback. No Gemini request, generated result, or fake production provider is claimed.

## Milestone 2 actual run

Final `npm.cmd test` output on 2026-08-11:

```text
> gradion-book-illustrator@0.1.0 test
> vitest run

 RUN  v4.1.10 D:/Gradion/gradion-book-illustrator

 Test Files  5 passed (5)
      Tests  25 passed (25)
   Start at  17:25:20
   Duration  1.87s (transform 378ms, setup 941ms, import 1.53s, tests 1.75s, environment 2.04s)
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
✓ 111 modules transformed.
dist/client/index.html                   0.48 kB │ gzip:  0.30 kB
dist/client/assets/index-BHXnrZv6.css    8.85 kB │ gzip:  2.72 kB
dist/client/assets/index-DxvaQWaQ.js   302.43 kB │ gzip: 93.00 kB
✓ built in 222ms

> gradion-book-illustrator@0.1.0 build:server
> tsc -p tsconfig.server.json
```

Runtime smoke check: a dev server was already listening on port `3000`, and the additional Vite process selected `5174` because `5173` was occupied. The newly launched Vite page, direct health endpoint, and Vite-proxied health endpoint returned:

```text
HealthStatus    : 200
HealthBody      : {"status":"ok"}
FrontendStatus  : 200
FrontendHasRoot : True
ProxyStatus     : 200
ProxyBody       : {"status":"ok"}
```

The additional `npm run dev` process tree was stopped after this check; the pre-existing development process was left untouched.

## Milestone 3 coverage

Backend M3 integration tests use the real Express routes, temporary filesystem storage, and temporary SQLite databases with a fake injected only at the `GeminiGateway` boundary. They cover both generated and user-provided Style paths, zero and two adult characters, ordered execution, one idempotent loser for duplicate starts, stored interaction reuse, immediate intermediate persistence, retry from the last successful boundary, server rejection of more than two characters, error clearing, and explicit context rebuilding after Gemini reports an expired chain. Separate gateway tests inspect the exact SDK request construction for upload, prompts, stored interaction chaining, Standard tier, structured response schema, context-expiry normalization, and zero automatic retries.

Frontend tests cover editable Style input before step 1, the user-triggered Generate action, enabled retry for the failed current M3 step, no Style editing after completion, and rendering persisted Style and Character results. Portraits remain a visible placeholder and steps 3–5 remain disabled.

These tests do not call Gemini and do not claim that a real API key, model response, or image flow passed. The real-key M3 smoke check is pending explicit project-owner approval.

## Milestone 3 actual run

Final `npm.cmd test` output on 2026-08-11:

```text
> gradion-book-illustrator@0.1.0 test
> vitest run

 RUN  v4.1.10 D:/Gradion/gradion-book-illustrator

 Test Files  7 passed (7)
      Tests  39 passed (39)
   Start at  19:02:47
   Duration  2.36s (transform 697ms, setup 1.85s, import 3.18s, tests 3.45s, environment 2.47s)
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
✓ 111 modules transformed.
dist/client/index.html                   0.48 kB │ gzip:  0.30 kB
dist/client/assets/index-pJaJpH7p.css    9.70 kB │ gzip:  2.88 kB
dist/client/assets/index-Dkc-PaZs.js   305.59 kB │ gzip: 93.72 kB
✓ built in 144ms

> gradion-book-illustrator@0.1.0 build:server
> tsc -p tsconfig.server.json
```

Built-server smoke check used isolated port `3301`, database `./data/m3-smoke.sqlite`, and no Gemini key:

```text
API listening on http://localhost:3301

StatusCode : 200
Body       : {"status":"ok"}
```

The smoke process was stopped and its temporary database was removed afterward. This verifies server startup and SQLite health only; it is not presented as a Gemini integration result.

## Milestone 4 coverage

Backend M4 integration tests use the real Express routes, temporary SQLite databases, and temporary upload directories with a fake injected only at the `GeminiImageGateway` boundary. They prove that portraits run sequentially, each completed image and interaction ID is persisted before the next call, a partial failure retains completed work, an explicit retry generates only missing portraits, an expired image chain is rebuilt from completed local images, zero characters completes without an image request, duplicate starts have one claimed attempt, and authenticated image serving enforces project ownership.

Separate image-gateway tests inspect the exact Standard-tier request for `gemini-3.1-flash-image`, PNG `1K` output at `9:16`, stored interaction chaining, omission of a separate seed image, local references only during rebuilding, timeout settings, and zero automatic retries. They also reject invalid base64, MIME/signature mismatch, unsupported image formats, and normalize expired interaction failures. Frontend tests cover the enabled Portrait action, per-character queued/generating/completed/failed presentation, retained completed images, and explicit Retry Portraits action. No test calls Gemini or claims a paid image response succeeded.

## Milestone 4 actual run

Final `npm.cmd test` output on 2026-08-11:

```text
> gradion-book-illustrator@0.1.0 test
> vitest run

 RUN  v4.1.10 D:/Gradion/gradion-book-illustrator

 Test Files  9 passed (9)
      Tests  52 passed (52)
   Start at  21:32:59
   Duration  2.48s (transform 863ms, setup 2.41s, import 3.87s, tests 5.21s, environment 2.52s)
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
✓ 111 modules transformed.
dist/client/index.html                   0.48 kB │ gzip:  0.30 kB
dist/client/assets/index-cI3SVMa1.css   10.19 kB │ gzip:  3.00 kB
dist/client/assets/index-BiOIQoTg.js   306.28 kB │ gzip: 93.92 kB
✓ built in 138ms

> gradion-book-illustrator@0.1.0 build:server
> tsc -p tsconfig.server.json
```

Built-server smoke check used isolated port `3302`, database `./data/m4-smoke.sqlite`, and no Gemini key:

```text
API listening on http://localhost:3302

StatusCode : 200
Content    : {"status":"ok"}
```

The smoke process was stopped and its temporary database was removed afterward. This verifies built-server startup, the M4 migration, and SQLite health only; it is not presented as a real Gemini portrait result.

## Milestone 5 coverage

Backend M5 integration tests use the real Express routes, migration, SQLite state transitions, and filesystem with fakes only at the two Gemini gateway boundaries. They cover server-side ordering for Chapters and Illustrations, an exact-one Chapter result, rejection and explicit retry of an empty Chapter response, normal text chaining from Characters, text-context rebuilding from the local book/style plus persisted character prompts, a final image chained directly from the last portrait, image-context rebuilding from completed local portraits, the zero-adult path, result persistence, project completion, authenticated image serving, and cross-user denial. Existing duplicate-claim, stale recovery, and old-attempt conditional-write tests remain part of the same full suite.

Gateway tests inspect the exact one-item structured Chapter schema, persisted character input, Standard service tier, stored interactions, zero automatic retries, and the direct PNG `1K` `16:9` Illustration request without a transition-only image call. Frontend tests cover explicit actions for steps 4–5, failed Illustration retry, completed final image, retained book content, and the `Done` project state.

No automated test calls Gemini. A paid-key image response and real end-to-end model consistency remain deliberately unverified.

## Milestone 5 actual run

The full suite was run once after implementation on 2026-08-11. `npm.cmd test` output:

```text
> gradion-book-illustrator@0.1.0 test
> vitest run

 RUN  v4.1.10 D:/Gradion/gradion-book-illustrator

 Test Files  10 passed (10)
      Tests  62 passed (62)
   Start at  22:25:59
   Duration  4.02s (transform 1.45s, setup 4.07s, import 7.43s, tests 9.46s, environment 4.76s)
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
✓ 111 modules transformed.
dist/client/index.html                   0.48 kB │ gzip:  0.30 kB
dist/client/assets/index-D5lBUl6y.css   10.75 kB │ gzip:  3.09 kB
dist/client/assets/index-DJJBujbd.js   307.52 kB │ gzip: 93.99 kB
✓ built in 165ms

> gradion-book-illustrator@0.1.0 build:server
> tsc -p tsconfig.server.json
```

Built-server smoke check used isolated port `3303`, database `./data/m5-smoke.sqlite`, and no Gemini key:

```text
API listening on http://localhost:3303

StatusCode : 200
Content    : {"status":"ok"}
```

The smoke job was stopped and its temporary database was removed afterward. This verifies startup, all migrations through M5, and SQLite health only; it is not presented as a real Gemini integration result.
