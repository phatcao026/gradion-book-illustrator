# Working agreement

- Treat `docs/reference/gradion-assessment-intern-software-engineer.md` as the product contract and `docs/reference/app-demo.html` as a behavior reference, not production code.
- Keep the implementation lean and TypeScript-first: React + Vite in `src/client`, Express + SQLite in `src/server`, and shared contracts in `src/shared` when they are genuinely needed.
- Run pipeline steps only after explicit user actions, in order, and enforce cost caps and duplicate prevention on the server when those features are implemented.
- Persist successful work immediately. Never add automatic Gemini retry loops; retries must remain user-triggered.
- Keep secrets, runtime databases, uploads, generated images, and `.env` files out of Git.
- Do not claim a test, integration, or Gemini flow passed unless it was run successfully. Record only real engineering decisions and AI overrides in `DECISIONS.md`.
- Before handing off a change, run `npm test`, `npm run build`, and review `git status` plus `git diff`.

