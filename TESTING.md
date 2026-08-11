# Testing

## Strategy

Vitest is the single automated test runner. Backend integration tests use Supertest against the real Express application with temporary on-disk SQLite databases and upload directories. Frontend tests use React Testing Library with jsdom. Pipeline tests exercise real state transitions, multiple SQLite connections, attempt ownership, and recovery races. Gemini gateways are replaced only at their external boundary, so automated tests inspect exact request contracts without using an API key or spending quota.

## Coverage

The backend suite covers health, identity and session cookies, user isolation, project creation from pasted text or validated UTF-8 `.txt` files, filesystem persistence, ordered pipeline claims, duplicate prevention, stale recovery, conditional writes, server-side character/chapter caps, partial-result preservation, authenticated image serving, and explicit retry behavior. Gateway tests cover file-upload request shape, stored interaction chaining, structured response validation, JPEG image requests, image byte validation, context-expiry recovery, error classification, and zero automatic retries.

Frontend tests cover identity and project screens, validation, persisted Style/Character/Chapter results, per-image queued/generating/completed/failed states, retry and recovery actions, final project completion, and keyboard/live-region accessibility behavior.

## Commands

```bash
npm test
npm run build
```

## Latest local test report

Environment: Windows, Node.js `v24.15.0`, npm `11.12.1`. Final pre-submission run on 2026-08-12:

```text
> gradion-book-illustrator@0.1.0 test
> vitest run

Test Files  10 passed (10)
     Tests  68 passed (68)
  Duration  3.41s
```

`npm.cmd run build` also completed successfully: client TypeScript checking passed, Vite built 111 modules, and server TypeScript compilation exited successfully.

## Manual acceptance

The local browser pass exercised identity validation, project creation, double-click duplicate prevention, refresh, a second tab, logout/login, server restart, persisted failure/retry UI, stale-attempt recovery, the health endpoint, and desktop layout. Temporary verification data was isolated from normal runtime data.

On 2026-08-12, after the Gemini Files upload and Interactions JPEG corrections, the project owner restarted the application and completed all five ordered steps through the real UI with a billed Gemini project: Style, Characters, Portraits, Chapters, and Illustrations. All five result sections were generated successfully. This is owner-performed acceptance, not an automated test or agent-run provider call; no API key, project identifier, billing amount, or independent visual-consistency score is claimed.

## CI and deliberate exclusions

The project owner confirmed that the secret-free GitHub Actions workflow passed for commit `abf9a42`. It runs `npm ci`, `npm test`, and `npm run build` on Ubuntu with Node.js 24. A newly pushed documentation commit must receive its own green run before submission.

Automated tests deliberately do not call Gemini. They therefore prove request construction, persistence, retries, and failure handling through controlled gateway results, not live model quality. Real character consistency was not independently assessed in the recorded acceptance. A forced real-provider partial failure followed by process-restart recovery remains untested because it would add paid calls and nondeterministic external behavior.
